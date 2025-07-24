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
    // 1️⃣ Fetch all in-progress refunds
    const pending = await db
      .select()
      .from(ordersTable)
      .where(
        and(
          eq(ordersTable.refund_status, 'processed'),
          isNotNull(ordersTable.refund_id)
        )
      );

    for (const order of pending) {
      const { refund_id, refund_speed: currentSpeed } = order;
      if (!refund_id) continue;

      try {
        // 2️⃣ Fetch latest Razorpay refund object
        const refund = await razorpay.refunds.fetch(refund_id);

        // 3️⃣ Check if speed has changed
        if (
          refund.speed_processed &&
          refund.speed_processed !== currentSpeed
        ) {
          await db.update(ordersTable).set({
            refund_speed: refund.speed_processed,
            updatedAt: new Date().toISOString(),
          }).where(eq(ordersTable.refund_id, refund.id));

          console.log(`🔄 Speed updated → ${refund.id}: ${currentSpeed} → ${refund.speed_processed}`);
        }

        // 4️⃣ If refund is processed
        if (
          refund.status === 'processed' &&
          typeof refund.processed_at === 'number' &&
          refund.processed_at > 0
        ) {
          const completedAt = new Date(refund.processed_at * 1000).toISOString();

          await db.update(ordersTable).set({
            refund_status: 'processed',
            refund_completed_at: completedAt,
            paymentStatus: 'refunded',
            updatedAt: new Date().toISOString(),
          }).where(eq(ordersTable.refund_id, refund.id));

          console.log(`✅ Marked as processed → ${refund.id}`);
        } else {
          console.log(`⏳ Still processing → ${refund.id} (status: ${refund.status})`);
        }

      } catch (err) {
        console.error(`❌ Failed to fetch refund ${refund_id}: ${err.message}`);
      }
    }

  } catch (err) {
    console.error("❌ Poller DB error:", err.message);
  }
};
