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
    const { user, phone, amount, paymentMode = 'online' } = req.body;
    if (!user) return res.status(401).send("login please");

    const amountPaise = amount * 100;
    const options = {
      amount: amountPaise,
      currency: 'INR',
      receipt: user.id,
    };

    razorpay.orders.create(options, async (err, order) => {
      if (err) {
        console.error('Order creation failed:', err);
        return res.status(400).json({ success: false, msg: 'Order creation failed' });
      }

      const now = new Date().toISOString();

      await db.insert(ordersTable).values({
        id: `DA${Date.now()}`,
        userId: user.id,
        totalAmount: amount,
        paymentMode: paymentMode,
        transactionId: null,
        paymentStatus: 'created',
        phone: phone,
        createdAt: now,
        updatedAt: now,
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
    console.error('CreateOrder error:', e);
    res.status(500).json({ success: false, msg: 'Server error' });
  }
};

export const verify = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ success: false, error: "Missing fields" });
    }

    const generatedSignature = crypto
      .createHmac("sha256", RAZORPAY_SECRET_KEY)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (generatedSignature !== razorpay_signature) {
      return res.status(400).json({ success: false, error: "Verification failed" });
    }

    await db
      .update(ordersTable)
      .set({
        transactionId: razorpay_payment_id,
        paymentStatus: 'paid',
        updatedAt: new Date().toISOString(),
      })
      .where(eq(ordersTable.order_id, razorpay_order_id));

    return res.json({ success: true, message: "Payment verified successfully." });
  } catch (error) {
    console.error("Verification error:", error.message);
    return res.status(500).json({ success: false, error: "Server error during verification." });
  }
};

export const refund = async (req, res) => {
  try {
    const { orderId, amount, speed } = req.body;

    if (!orderId || !amount) {
      return res.status(400).json({ success: false, error: "Missing orderId or amount" });
    }

    const [order] = await db
      .select({ paymentId: ordersTable.transactionId })
      .from(ordersTable)
      .where(eq(ordersTable.id, orderId));

    if (!order?.paymentId) {
      return res.status(404).json({ success: false, error: "Order or payment not found" });
    }

    const refund = await razorpay.payments.refund(order.paymentId, {
      amount,
      speed: speed || 'optimum',
    });

    await db
      .update(ordersTable)
      .set({
        refund_id: refund.id,
        refund_amount: refund.amount,
        refund_status: refund.status,
        refund_speed: refund.speed || null,
        refund_initiated_at: new Date(),
        refund_completed_at: refund.status === 'processed' ? new Date() : null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(ordersTable.id, orderId));

    res.json({ success: true, refund });
  } catch (err) {
    console.error("Refund error:", err);
    res.status(500).json({ success: false, error: err.message || "Refund failed" });
  }
};
export const webhook = async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const body = req.body.toString();

  const generatedSignature = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("hex");

  if (generatedSignature !== signature) {
    return res.status(400).json({ success: false, error: "Invalid signature" });
  }

  // Handle the webhook event
  const event = req.body.event;
  switch (event) {
    case "payment.captured":
      // Handle payment captured event
      break;
    case "payment.failed":
      // Handle payment failed event
      break;
    default:
      return res.status(400).json({ success: false, error: "Unknown event" });
  }

  res.json({ success: true });
};