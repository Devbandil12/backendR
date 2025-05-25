// import Razorpay from "razorpay";
// import express from "express";
// import { db } from "../configs";                // your drizzle setup
// import { ordersTable } from "../configs/schema";
// import { eq } from "drizzle-orm";

// const router = express.Router();

// // initialize Razorpay client
// const razorpay = new Razorpay({
//   key_id: process.env.RAZORPAY_KEY_ID,
//   key_secret: process.env.RAZORPAY_KEY_SECRET,
// });

// /**
//  * POST /orders/:orderId/refund
//  * Body: { reason?: string }
//  */
//  router.post("/:orderId/refund", async (req, res) => {
//   const { orderId } = req.params;
//   const { reason } = req.body;

//   try {
//     // 1) Lookup payment_id from your DB
//     const [order] = await db
//       .select({ paymentId: ordersTable.transactionId })
//       .from(ordersTable)
//       .where(eq(ordersTable.id, Number(orderId)));

//     if (!order || !order.paymentId) {
//       return res.status(404).json({ error: "Order or payment not found" });
//     }
//      const refund = await razorpay.payments.refund(order.paymentId, {
//       amount: undefined, // omit to refund full amount, or specify in paise
//       speed: "normal",   // or 'optimum' / 'instant'
//       notes: { reason: reason || "User-initiated cancellation" },
//     });

//     // 3) Update your DB: mark paymentStatus = 'refunded'
//     await db
//       .update(ordersTable)
//       .set({ paymentStatus: "refunded", status: "Order Cancelled" })
//       .where(eq(ordersTable.id, Number(orderId)));

//     // 4) (Optional) send notification email here…

//     res.json({ success: true, refund });
//   }
//     // 2) Issue refund request to Razorpay
   
//   catch (err) {
//     console.error("Refund error:", err);
//     res.status(500).json({ error: "Refund failed" });
//   }
// });