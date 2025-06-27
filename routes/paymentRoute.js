// routes/paymentRoute.js

import express from "express";
import bodyParser from "body-parser";
import crypto from "crypto";
import Razorpay from "razorpay";
import multer from 'multer';
import pdf from 'pdf-parse';// File upload
import { db } from "../configs/index.js";
import { ordersTable } from "../configs/schema.js";
import { eq } from "drizzle-orm";
import { createOrder, verifyPayment } from "../controllers/paymentController.js";

const router = express.Router();

// ──────────────────────────────────────────────────────────────────────────────
// Parse JSON & URL-encoded bodies for /createOrder, /verify-payment, /refund
// ──────────────────────────────────────────────────────────────────────────────
router.use(bodyParser.json());
router.use(bodyParser.urlencoded({ extended: false }));

// ──────────────────────────────────────────────────────────────────────────────
// Razorpay client & webhook secret
// ──────────────────────────────────────────────────────────────────────────────
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_ID_KEY,
  key_secret: process.env.RAZORPAY_SECRET_KEY,
});
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;
const upload = multer({ storage: multer.memoryStorage() });// 2️⃣ PDF upload & parse

// ──────────────────────────────────────────────────────────────────────────────
// 1) Create a new Razorpay order
//    POST /api/payment/createOrder
// ──────────────────────────────────────────────────────────────────────────────
router.post("/createOrder", createOrder);

// ──────────────────────────────────────────────────────────────────────────────
// 2) Verify a payment signature
//    POST /api/payment/verify-payment
// ──────────────────────────────────────────────────────────────────────────────
router.post("/verify-payment", verifyPayment);

// ──────────────────────────────────────────────────────────────────────────────
// 3) Issue a refund (with 5% fee) and record metadata
//    POST /api/payment/refund
// ──────────────────────────────────────────────────────────────────────────────
router.post("/refund", async (req, res) => {
  const { orderId } = req.body;
  console.log("🔔 Received refund request for orderId:", orderId);

  try {
    const [order] = await db
      .select({
        paymentId: ordersTable.transactionId,
        totalAmount: ordersTable.totalAmount,
      })
      .from(ordersTable)
      .where(eq(ordersTable.id, orderId));

    console.log("🔍 DB order lookup result:", order);

    if (!order?.paymentId || order.paymentId === "null") {
      console.warn("❌ No payment ID found for order:", orderId);
      return res.status(404).json({ error: "Order not found or unpaid" });
    }

    const feePercent = 5;
    const fee = Math.floor((order.totalAmount * feePercent) / 100);
    const refundAmt = order.totalAmount - fee;
    console.log(`↩️ Refunding ₹${refundAmt} (paise: ${refundAmt * 100})`);

    // Call Razorpay API
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
    console.error("❗ Refund error:", err); // <-- important
    return res.status(500).json({ error: err.message || "Refund failed" });
  }
});

router.post('/getdata', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    const result = await pdf(req.file.buffer);
    res.status(200).json({ text: result.text });
  } catch (error) {
    console.error('Error processing file:', error);
    res.status(500).json({ error: error.message });
  }
});
// ──────────────────────────────────────────────────────────────────────────────
// 4) Razorpay Webhook endpoint for refund lifecycle updates
//    POST /api/payment/razorpay-webhook
//    (must be raw body for signature verification)
// ──────────────────────────────────────────────────────────────────────────────
router.post(
  "/razorpay-webhook",
  bodyParser.raw({ type: "application/json" }),
  async (req, res) => {
    const payload   = req.body; // Buffer
    const signature = req.headers["x-razorpay-signature"];

    // Verify signature using webhook secret :contentReference[oaicite:2]{index=2}
    const expected = crypto
      .createHmac("sha256", WEBHOOK_SECRET)
      .update(payload)
      .digest("hex");

    if (signature !== expected) {
      console.warn("⚠️ Webhook signature mismatch");
      return res.status(400).send("Invalid signature");
    }

    // Parse event
    const { event: eventName, payload: data } = JSON.parse(
      payload.toString("utf8")
    );
    const refund = data.refund.entity;
    const {
      id:            refundId,
      payment_id,
      status:        refundStatus,
      speed:         refundSpeed,
      amount:        refundAmount,
      created_at:    createdAtUnix,
    } = refund;

    // Build update fields
    const updateFields = {
      refund_id:           refundId,
      refund_status:       refundStatus,
      refund_speed:        refundSpeed,
      refund_amount:       refundAmount,
      refund_initiated_at: new Date(createdAtUnix * 1000),
      refund_updated_at:   new Date(),
    };

    // On processed/failed, set completion timestamp :contentReference[oaicite:3]{index=3}
    if (eventName === "refund.processed" || eventName === "refund.failed") {
      updateFields.refund_completed_at =
        refundStatus === "processed" ? new Date() : null;
    }

    try {
      await db
        .update(ordersTable)
        .set(updateFields)
        .where(eq(ordersTable.transactionId, payment_id));

      console.log(`✅ Handled ${eventName} for refund ${refundId}`);
      return res.json({ ok: true });
    } catch (err) {
      console.error("Webhook DB update error:", err);
      return res.status(500).send("DB update failed");
    }
  }
);

export default router;
