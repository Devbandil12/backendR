// server/controllers/refundController.js
import Razorpay from 'razorpay';
import { db } from '../configs/index.js';
import { ordersTable } from '../configs/schema.js';
import { eq } from 'drizzle-orm';



export const refundOrder = async (req, res) => {
  const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_ID_KEY,
    key_secret: process.env.RAZORPAY_SECRET_KEY,
  });

  try {
    const { orderId, amount } = req.body;
    if (!orderId || !amount) {
      return res.status(400).json({ success: false, error: "Missing orderId or amount" });
    }

    // Step 1: Fetch order from DB
    const [order] = await db
      .select({
        paymentId: ordersTable.transactionId,
        status: ordersTable.status,
        refundId: ordersTable.refund_id,
      })
      .from(ordersTable)
      .where(eq(ordersTable.id, orderId));

    if (!order) {
      return res.status(404).json({ success: false, error: "Order not found" });
    }
    if (order.status !== "order placed") {
      return res.status(400).json({ success: false, error: "Cannot refund after order progressed" });
    }
    if (order.refundId) {
      return res.status(400).json({ success: false, error: "Refund already initiated" });
    }
    if (!order.paymentId) {
      return res.status(404).json({ success: false, error: "No payment found to refund" });
    }

    // Step 2: Convert amount to paise
    const amountInPaise = Math.round(amount * 100);
    const refundInPaise = Math.round(amountInPaise * 0.95);

    // 🟩 Step 3: Fetch payment to see what Razorpay has recorded
    const payment = await razorpay.payments.fetch(order.paymentId);

    console.log(`🪙 Captured amount: ${payment.amount} paise (₹${(payment.amount / 100).toFixed(2)})`);
    console.log(`↩️  Refund requested: ${refundInPaise} paise (₹${(refundInPaise / 100).toFixed(2)})`);

    // Step 4: Validate
    const alreadyRefunded = (payment.refunds || []).reduce((sum, r) => sum + (r.amount || 0), 0);
    const maxRefundable = payment.amount - alreadyRefunded;
    if (refundInPaise > maxRefundable) {
      return res.status(400).json({
        success: false,
        error: `Refund amount exceeds remaining refundable amount ₹${(maxRefundable / 100).toFixed(2)}.`,
      });
    }

    // Step 5: Call refund
    const refund = await razorpay.payments.refund(order.paymentId, {
      amount: refundInPaise,
      speed: 'optimum',
    });

    // Step 6: Persist refund data in DB
    await db
      .update(ordersTable)
      .set({
        paymentStatus: 'refunded',
        refund_id: refund.id,
        refund_amount: refund.amount,
        refund_status: refund.status,
        refund_speed: refund.speed_processed,
        refund_initiated_at: new Date(refund.created_at * 1000),
        refund_completed_at: refund.status === 'processed'
          ? new Date(refund.processed_at * 1000)
          : null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(ordersTable.id, orderId));

    return res.json({ success: true, refund });

  } catch (err) {
    console.error("refundOrder error:", err);
    if (err.statusCode) {
      return res.status(err.statusCode).json({ success: false, error: err.error?.description || err.message });
    }
    return res.status(500).json({ success: false, error: "Internal Server Error" });
  }
};

