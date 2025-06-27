// controllers/paymentController.js

import Razorpay from "razorpay";
import crypto from "crypto";
import { db } from "../configs/index.js";             // your Drizzle setup
import { ordersTable } from "../configs/schema.js";
import { eq } from "drizzle-orm";

const {
  RAZORPAY_ID_KEY,
  RAZORPAY_SECRET_KEY,
  RAZORPAY_WEBHOOK_SECRET,
} = process.env;

// Initialize Razorpay client
const razorpay = new Razorpay({
  key_id: RAZORPAY_ID_KEY,
  key_secret: RAZORPAY_SECRET_KEY,
});

/**
 * 1) Create a new Razorpay order
 */
export async function createOrder(req, res) {
  try {
    const { user, phone, amount } = req.body;
    if (!user) {
      return res.status(401).json({ success: false, error: "Login required." });
    }

    const orderAmount = Math.round(amount * 100); // amount in paise
    const options = {
      amount: orderAmount,
      currency: "INR",
      receipt: `rcpt_${Date.now()}`,
    };

    razorpay.orders.create(options, (err, order) => {
      if (err) {
        console.error("Order creation failed:", err);
        return res.status(400).json({ success: false, error: "Order creation error." });
      }

      return res.status(200).json({
        success: true,
        message: "Order created",
        order_id: order.id,
        amount: orderAmount,
        key_id: RAZORPAY_ID_KEY,
        contact: phone,
        name: user.fullName,
        email: user.primaryEmailAddress.emailAddress,
      });
    });
  } catch (error) {
    console.error("createOrder error:", error);
    return res.status(500).json({ success: false, error: "Server error." });
  }
}

/**
 * 2) Verify a payment signature
 */
export async function verifyPayment(req, res) {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ success: false, error: "Missing required fields." });
    }

    const generatedSignature = crypto
      .createHmac("sha256", RAZORPAY_SECRET_KEY)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (generatedSignature === razorpay_signature) {
      return res.status(200).json({ success: true, message: "Payment verified." });
    } else {
      return res.status(400).json({ success: false, error: "Signature verification failed." });
    }
  } catch (error) {
    console.error("verifyPayment error:", error);
    return res.status(500).json({ success: false, error: "Server error." });
  }
}

/**
 * 3) Issue a refund with a 5% fee, store refund metadata
 */
export async function issueRefund(req, res) {
  try {
    const { orderId } = req.body;
    if (!orderId) {
      return res.status(400).json({ success: false, error: "orderId is required." });
    }

    // Fetch the original payment ID and amount
    const [order] = await db
      .select({
        paymentId:   ordersTable.transactionId,
        totalAmount: ordersTable.totalAmount,
      })
      .from(ordersTable)
      .where(eq(ordersTable.id, orderId));

    if (!order?.paymentId || order.paymentId === "null") {
      return res.status(404).json({ success: false, error: "Order not found or unpaid." });
    }

    // Calculate refund amount minus 5% fee
    const feePercent = 5;
    const feeAmount  = Math.floor((order.totalAmount * feePercent) / 100);
    const refundAmount = order.totalAmount - feeAmount;

    // Call Razorpay refund API (amount in paise)
    const refund = await razorpay.payments.refund(order.paymentId, {
      amount: refundAmount * 100,
      speed:  "instant",
      notes:  { reason: "User cancellation" },
    });

    // Persist refund details into the DB
    await db
      .update(ordersTable)
      .set({
        status:              "Order Cancelled",
        paymentStatus:       "refunded",
        refund_id:           refund.id,
        refund_status:       refund.status,
        refund_speed:        refund.speed,
        refund_amount:       refund.amount,
        refund_initiated_at: new Date(refund.created_at * 1000),
        refund_updated_at:   new Date(),
      })
      .where(eq(ordersTable.id, Number(orderId)));

    return res.status(200).json({ success: true, refund });
  } catch (error) {
    console.error("issueRefund error:", error);
    return res.status(500).json({ success: false, error: "Refund failed." });
  }
}

/**
 * 4) Handle Razorpay webhook events (refund.processed, refund.failed, etc.)
 */
export async function handleRazorpayWebhook(req, res) {
  const payload   = req.body; // raw Buffer
  const signature = req.headers["x-razorpay-signature"];

  // Verify webhook signature
  const expectedSignature = crypto
    .createHmac("sha256", RAZORPAY_WEBHOOK_SECRET)
    .update(payload)
    .digest("hex");

  if (signature !== expectedSignature) {
    console.warn("⚠️ Webhook signature mismatch");
    return res.status(400).send("Invalid signature");
  }

  // Parse event payload
  let event;
  try {
    event = JSON.parse(payload.toString("utf8"));
  } catch (err) {
    console.error("Invalid JSON payload in webhook:", err);
    return res.status(400).send("Bad payload");
  }

  const { event: eventName, payload: data } = event;
  const refund = data.refund.entity;

  // Extract refund details
  const {
    id:           refundId,
    payment_id:   paymentId,
    status:       refundStatus,
    speed:        refundSpeed,
    amount:       refundAmount,
    created_at:   createdAtUnix,
  } = refund;

  // Prepare fields to update
  const updateFields = {
    refund_id:           refundId,
    refund_status:       refundStatus,
    refund_speed:        refundSpeed,
    refund_amount:       refundAmount,
    refund_initiated_at: new Date(createdAtUnix * 1000),
    refund_updated_at:   new Date(),
  };

  // If refund is processed or failed, record completion timestamp
  if (eventName === "refund.processed" || eventName === "refund.failed") {
    updateFields.refund_completed_at =
      refundStatus === "processed" ? new Date() : null;
  }

  try {
    await db
      .update(ordersTable)
      .set(updateFields)
      .where(eq(ordersTable.transactionId, paymentId));

    console.log(`✅ Handled ${eventName} for refund ${refundId}`);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Webhook DB update error:", err);
    return res.status(500).send("DB update failed");
  }
}
