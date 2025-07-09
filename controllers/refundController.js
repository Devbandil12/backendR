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

    // 1) Fetch status/paymentId/refundId
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
      return res.status(400).json({
        success: false,
        error: "Cannot cancel/refund after order has progressed",
      });
    }
    if (order.refundId) {
      return res.status(400).json({
        success: false,
        error: "Refund already initiated",
      });
    }
    if (!order.paymentId) {
      return res.status(404).json({
        success: false,
        error: "No payment found to refund",
      });
    }
    const amountInPaise = Math.round(amount * 100);

    // 2) Razorpay refund
    const refund = await razorpay.payments.refund(order.paymentId, {
      amount: amountInPaise,
      speed: 'optimum',
    });

    // 3) Persist
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
    return res.status(500).json({ success: false, error: err.message });
  }
};
