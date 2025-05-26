import express from "express"
import { db } from "../configs/index.js";                // your drizzle setup
import { eq } from "drizzle-orm";
import Razorpay from "razorpay";
import { ordersTable } from "../configs/schema.js";
 const payment_route = express();

import bodyParser from 'body-parser';
payment_route.use(bodyParser.json());
payment_route.use(bodyParser.urlencoded({ extended:false }));


const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_ID_KEY,
  key_secret: process.env.RAZORPAY_SECRET_KEY,
});

import paymentController  from '../controllers/paymentController.js';



payment_route.post('/createOrder', paymentController.createOrder);
payment_route.post('/verify-payment', paymentController.verify);



 
payment_route.post("/refund", async (req, res) => {
  const { orderId } = req.body;
  try {
    // 1) Lookup payment_id from your DB
    const [order] = await db
      .select({ paymentId: ordersTable.transactionId })
      .from(ordersTable)
      .where(eq(ordersTable.id,orderId));
    if (!order || !order.paymentId) {
      return res.json({ error: "Order or payment not found" });
    }
     const refund = await razorpay.payments.refund(order.paymentId, {
      amount: undefined, // omit to refund full amount, or specify in paise
      speed: "normal",   // or 'optimum' / 'instant'
      notes: { reason: "User-initiated cancellation" },
    });

    // 3) Update your DB: mark paymentStatus = 'refunded'
    await db
      .update(ordersTable)
      .set({ paymentStatus: "refunded", status: "Order Cancelled" })
      .where(eq(ordersTable.id, Number(orderId)));

    // 4) (Optional) send notification email here…

    res.json({ success: true, refund });
  }
    // 2) Issue refund request to Razorpay
   
  catch (err) {
    console.error("Refund error:", err);
    res.status(500).json({ error: "Refund failed" });
  }
});

export const payment_routes=payment_route

