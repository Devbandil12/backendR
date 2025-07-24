// refundPoller.js
import 'dotenv/config';
import Razorpay from 'razorpay';
import { db } from '../src/configs/index.js';
import { ordersTable } from '../src/configs/schema.js';
import { eq, and, isNotNull } from 'drizzle-orm';

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_ID_KEY,
  key_secret: process.env.RAZORPAY_SECRET_KEY,
});

export const pollRefunds = async () => {
  console.log("🔄 Polling: Checking in_progress refunds...");

  try {
    // 1️⃣ Grab all in-progress refunds
    const pending = await db
      .select()
      .from(ordersTable)
      .where(and(
        eq(ordersTable.refund_status, 'in_progress'),
        isNotNull(ordersTable.refund_id)
      ));

    for (const order of pending) {
      const { refund_id, refund_speed: currentSpeed } = order;
      if (!refund_id) continue;

      try {
        // 2️⃣ Fetch latest refund details from Razorpay
        const refund = await razorpay.refunds.fetch(refund_id);

        // 3️⃣ Speed change?
        if (refund.speed_processed && refund.speed_processed !== currentSpeed) {
          await db.update(ordersTable).set({
            refund_speed: refund.speed_processed,
            updatedAt: new Date().toISOString(),
          }).where(eq(ordersTable.refund_id, refund.id));
          console.log(`🔄 Updated speed for ${refund.id}: ${refund.speed_processed}`);
        }

        // 4️⃣ If processed → mark completed
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
          console.log(`⏳ ${refund.id} still in status: ${refund.status}`);
        }

      } catch (err) {
        console.error(`❌ Razorpay fetch failed for refund ${refund_id}:`, err.message);
      }
    }

  } catch (err) {
    console.error("❌ Poller DB error:", err.message);
  }
};
