// routes/paymentRoute.js
import express from "express";
import bodyParser from "body-parser";
import crypto from "crypto";
import Razorpay from "razorpay";
import { db } from "../configs/index.js";
import { ordersTable } from "../configs/schema.js";
import { eq } from "drizzle-orm";
import { createOrder, verifyPayment } from "../controllers/paymentController.js";

const router = express.Router();

// Parse JSON and urlencoded bodies
router.use(bodyParser.json());
router.use(bodyParser.urlencoded({ extended: false }));

// Razorpay instance with keys from .env
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_ID_KEY,
  key_secret: process.env.RAZORPAY_SECRET_KEY,
});
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;

// ─────────────────────────────────────────────
// Create order
router.post("/createOrder", createOrder);

// Verify payment
router.post("/verify-payment", verifyPayment);

// Refund route
router.post("/refund", async (req, res) => {
  const { orderId } = req.body;
  console.log("🔥 /refund route hit, body:", req.body);

  try {
    // Find order in DB
    const [order] = await db
      .select({
        paymentId: ordersTable.transactionId,
        totalAmount: ordersTable.totalAmount,
      })
      .from(ordersTable)
      .where(eq(ordersTable.id, orderId));

    console.log("🧾 Order before refund:", order);

    if (!order?.paymentId || order.paymentId === "null") {
      console.warn("❌ No payment ID found for order:", orderId);
      return res.status(404).json({ error: "Order not found or unpaid" });
    }

    // Refund amount minus 5% fee
    const fee = Math.floor(order.totalAmount * 0.05);
    const refundAmt = order.totalAmount - fee;
    console.log(`↩️ Refunding ₹${refundAmt} (paise: ${refundAmt * 100})`);

    const refund = await razorpay.payments.refund(order.paymentId, {
      amount: refundAmt * 100,
      speed: "normal",
      notes: { reason: "User cancellation" },
    });

    console.log("✅ Razorpay refund response:", refund);

    await db
      .update(ordersTable)
      .set({
        status: "Order Cancelled",
        paymentStatus: "refunded",
        refund_id: refund.id,
        refund_status: refund.status,
        refund_speed: refund.speed,
        refund_amount: refund.amount,
        refund_initiated_at: new Date(refund.created_at * 1000),
        refund_updated_at: new Date(),
      })
      .where(eq(ordersTable.id, orderId));

    console.log("💾 Refund info saved to DB");

    return res.json({ success: true, refund });
  } catch (err) {
    console.error("❗ Refund error:", err);
    if (err?.error?.description) {
      console.error("🔍 Razorpay error:", err.error.description);
    }
    return res.status(500).json({
      success: false,
      error: err.message || "Refund failed internally",
    });
  }
});

// ─────────────────────────────────────────────
// Razorpay webhook for refund updates
router.post(
  "/razorpay-webhook",
  bodyParser.raw({ type: "application/json" }),
  async (req, res) => {
    const signature = req.headers["x-razorpay-signature"];
    const expected = crypto
      .createHmac("sha256", WEBHOOK_SECRET)
      .update(req.body)
      .digest("hex");

    if (signature !== expected) {
      console.warn("⚠️ Invalid webhook signature");
      return res.status(400).send("Invalid signature");
    }

    try {
      const { event: eventName, payload: data } = JSON.parse(
        req.body.toString("utf8")
      );
      const refund = data.refund.entity;

      const updateFields = {
        refund_id: refund.id,
        refund_status: refund.status,
        refund_speed: refund.speed,
        refund_amount: refund.amount,
        refund_initiated_at: new Date(refund.created_at * 1000),
        refund_updated_at: new Date(),
      };

      if (eventName === "refund.processed" || eventName === "refund.failed") {
        updateFields.refund_completed_at =
          refund.status === "processed" ? new Date() : null;
      }

      await db
        .update(ordersTable)
        .set(updateFields)
        .where(eq(ordersTable.transactionId, refund.payment_id));

      console.log(`✅ Handled ${eventName} for refund ${refund.id}`);
      return res.json({ ok: true });
    } catch (err) {
      console.error("Webhook DB update error:", err);
      return res.status(500).send("DB update failed");
    }
  }
);

export default router;
