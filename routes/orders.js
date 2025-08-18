import express from "express";
import Razorpay from "razorpay";
import { db } from "../configs/index.js";
import { ordersTable } from "../configs/schema.js";
import { eq, asc } from "drizzle-orm";

const router = express.Router();

// ─── Get all orders (Admin) ──────────────────────────────
router.get("/", async (req, res) => {
  try {
    const orders = await db.query.ordersTable.findMany({
      with: {
        orderItems: {
          with: { product: true },
        },
      },
      orderBy: [asc(ordersTable.createdAt)],
    });
    res.json(orders);
  } catch (err) {
    console.error("❌ Error fetching orders:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ─── Get single order by ID ──────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const [order] = await db.query.ordersTable.findMany({
      where: eq(ordersTable.id, id),
      with: {
        orderItems: {
          with: { product: true },
        },
      },
    });

    if (!order) return res.status(404).json({ error: "Order not found" });
    res.json(order);
  } catch (err) {
    console.error("❌ Error fetching order:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ─── Update order status (Admin) ─────────────────────────
router.put("/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    await db
      .update(ordersTable)
      .set({ status, updatedAt: new Date().toISOString() })
      .where(eq(ordersTable.id, id));

    res.json({ success: true, message: "Order status updated" });
  } catch (err) {
    console.error("❌ Error updating order status:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ─── Cancel an order ─────────────────────────────────────
router.put("/:id/cancel", async (req, res) => {
  try {
    const { id } = req.params;

    await db
      .update(ordersTable)
      .set({
        status: "Order Cancelled", // ✅ unified wording
        updatedAt: new Date().toISOString(),
      })
      .where(eq(ordersTable.id, id));

    res.json({ success: true, message: "Order cancelled" });
  } catch (err) {
    console.error("❌ Error cancelling order:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ─── Refund an order ─────────────────────────────────────
router.put("/:id/refund", async (req, res) => {
  const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_ID_KEY,
    key_secret: process.env.RAZORPAY_SECRET_KEY,
  });

  try {
    const { id } = req.params;
    const { amount } = req.body;

    if (!amount) {
      return res.status(400).json({ success: false, error: "Missing refund amount" });
    }

    // 1️⃣ Fetch order from DB
    const [order] = await db
      .select({
        paymentId: ordersTable.transactionId,
        status: ordersTable.status,
        refundId: ordersTable.refund_id,
      })
      .from(ordersTable)
      .where(eq(ordersTable.id, id));

    if (!order) return res.status(404).json({ success: false, error: "Order not found" });
    if (order.status !== "Order Placed") {
      return res.status(400).json({ success: false, error: "Refunds only allowed before processing" });
    }
    if (order.refundId) {
      return res.status(400).json({ success: false, error: "Refund already initiated" });
    }
    if (!order.paymentId) {
      return res.status(404).json({ success: false, error: "No payment found to refund" });
    }

    // 2️⃣ Convert amount to paise (with 5% deduction if > ₹1)
    const amountInPaise = Math.round(amount * 100);
    let refundInPaise = Math.round(amountInPaise * 0.95);
    if (refundInPaise < 100) refundInPaise = amountInPaise;

    // 3️⃣ Fetch payment info from Razorpay
    const payment = await razorpay.payments.fetch(order.paymentId);
    const alreadyRefunded = (payment.refunds || []).reduce((sum, r) => sum + (r.amount || 0), 0);
    const maxRefundable = payment.amount - alreadyRefunded;
    if (refundInPaise > maxRefundable) {
      return res.status(400).json({
        success: false,
        error: `Refund exceeds remaining refundable amount ₹${(maxRefundable / 100).toFixed(2)}.`,
      });
    }

    // 4️⃣ Call Razorpay refund API
    const refundInit = await razorpay.payments.refund(order.paymentId, {
      amount: refundInPaise,
      speed: "normal",
    });
    const refund = await razorpay.refunds.fetch(refundInit.id);

    // 5️⃣ Persist refund details in DB
    await db
      .update(ordersTable)
      .set({
        paymentStatus: "refunded",
        refund_id: refund.id,
        refund_amount: refund.amount,
        refund_status: refund.status,
        refund_speed: refund.speed,
        refund_initiated_at: new Date(refund.created_at * 1000),
        refund_completed_at: refund.processed_at ? new Date(refund.processed_at * 1000) : null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(ordersTable.id, id));

    res.json({ success: true, refund });
  } catch (err) {
    console.error("❌ refund error:", err);
    return res.status(err.statusCode || 500).json({
      success: false,
      error: err.error?.description || err.message || "Refund failed",
    });
  }
});

export default router;
