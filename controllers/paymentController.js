// server/controllers/paymentController.js
import Razorpay from 'razorpay';
import crypto from 'crypto';
import { db } from '../configs/index.js';
import { ordersTable } from '../configs/schema.js';
import { eq } from 'drizzle-orm';

const { RAZORPAY_ID_KEY, RAZORPAY_SECRET_KEY } = process.env;

const razorpay = new Razorpay({
  key_id: RAZORPAY_ID_KEY,
  key_secret: RAZORPAY_SECRET_KEY,
});

export const createOrder = async (req, res) => {
  try {
    const { user, phone, amount } = req.body;
    if (!user) return res.status(401).send("login please");

    const amountPaise = amount * 100;
    const options = { amount: amountPaise, currency: 'INR', receipt: user.id };

    razorpay.orders.create(options, async (err, order) => {
      if (err) {
        console.error(err);
        return res.status(400).json({ success: false, msg: 'Order creation failed' });
      }
      // Persist a draft order row with status “created”
      await db.insert(ordersTable).values({
        id: `DA${Date.now()}`,        // your PK logic
        userId: user.id,
        amount: amount,
        order_id: order.id,           // Razorpay order_id
        payment_status: 'created',
      });
      res.json({
        success: true,
        orderId: order.id,
        amount: amountPaise,
        keyId: RAZORPAY_ID_KEY,
        name: user.fullName,
        email: user.primaryEmailAddress.emailAddress,
        contact: phone,
      });
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, msg: 'Server error' });
  }
};

export const verify = async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature)
    return res.status(400).json({ success: false, error: "Missing fields" });

  const generated = crypto
    .createHmac("sha256", RAZORPAY_SECRET_KEY)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest("hex");

  if (generated !== razorpay_signature)
    return res.status(400).json({ success: false, error: "Verification failed" });

  // 1) Update DB row with the razorpay_payment_id
  await db
    .update(ordersTable)
    .set({ transaction_id: razorpay_payment_id, payment_status: 'paid' })
    .where(eq(ordersTable.order_id, razorpay_order_id));

  res.json({ success: true, message: "Payment verified" });
};

export const refund = async (req, res) => {
  try {
    const { orderId, amount, speed } = req.body;
    if (!orderId || !amount) {
      return res.status(400).json({ success: false, error: "Missing orderId or amount" });
    }

    // 1) Lookup the stored Razorpay payment ID
    const [order] = await db
      .select({ paymentId: ordersTable.transaction_id })
      .from(ordersTable)
      .where(eq(ordersTable.id, orderId));

    if (!order?.paymentId) {
      return res.status(404).json({ success: false, error: "Order/payment not found" });
    }

    // 2) Issue the refund
    const refund = await razorpay.payments.refund(order.paymentId, {
      amount,
      speed: speed || 'optimum',
    });

    // 3) Persist the refund ID & timestamp
    await db
      .update(ordersTable)
      .set({
        refund_id: refund.id,
        refund_status: refund.status,
        refunded_at: new Date(),
      })
      .where(eq(ordersTable.id, orderId));

    // 4) Return the refund object
    res.json({ success: true, refund });
  } catch (err) {
    console.error("Refund error:", err);
    res.status(500).json({ success: false, error: err.message || "Refund failed" });
  }
};
