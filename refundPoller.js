// refundPoller.js
import 'dotenv/config';
import Razorpay from 'razorpay';
import { db } from '../src/configs/index.js';
import { ordersTable } from '../src/configs/schema.js';
import { eq, and, or, isNotNull, isNull } from 'drizzle-orm';

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_ID_KEY,
  key_secret: process.env.RAZORPAY_SECRET_KEY,
});

export const pollRefunds = async () => {
  console.log("🔄 Polling: Checking pending/processed refunds...");

  try {
    const pending = await db
      .select()
      .from(ordersTable)
      .where(and(
        or(
          eq(ordersTable.refund_status, 'in_progress'),
          and(
            eq(ordersTable.refund_status, 'processed'),
            isNull(ordersTable.refund_completed_at)
          )
        ),
        isNotNull(ordersTable.refund_id)
      ));

    for (const order of pending) {
      const { refund_id, refund_speed: currentSpeed } = order;
      if (!refund_id) continue;

      try {
        const refund = await razorpay.refunds.fetch(refund_id);

        // 🔁 Speed change
        if (refund.speed_processed && refund.speed_processed !== currentSpeed) {
          await db.update(ordersTable).set({
            refund_speed: refund.speed_processed,
            updatedAt: new Date().toISOString(),
          }).where(eq(ordersTable.refund_id, refund.id));
          console.log(`⚡ Updated speed → ${refund.speed_processed} for ${refund.id}`);
        }

        // ✅ Processed
        if (refund.status === 'processed' && refund.processed_at > 0) {
          const completedAt = new Date(refund.processed_at * 1000).toISOString();

          await db.update(ordersTable).set({
            refund_status: 'processed',
            refund_completed_at: completedAt,
            paymentStatus: 'refunded',
            updatedAt: new Date().toISOString(),
          }).where(eq(ordersTable.refund_id, refund.id));
          console.log(`✅ Marked ${refund.id} as completed`);
        } else {
          console.log(`⏳ ${refund.id} still pending (${refund.status})`);
        }

      } catch (err) {
        console.error(`❌ Fetch error for ${refund_id}:`, err.message);
      }
    }

  } catch (err) {
    console.error("❌ Poller DB error:", err.message);
  }
};
