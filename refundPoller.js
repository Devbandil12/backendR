// refundPoller.js
import 'dotenv/config';
import Razorpay from 'razorpay';
import { db } from '../src/configs/index.js';
import { ordersTable } from '../src/configs/schema.js';
import { eq, and } from 'drizzle-orm';

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_ID_KEY,
  key_secret: process.env.RAZORPAY_SECRET_KEY,
});

export const pollRefunds = async () => {
  console.log("🔄 Polling: Checking Razorpay refund statuses...");

  try {
    const orders = await db
      .select()
      .from(ordersTable)
      .where(
        and(
          eq(ordersTable.refund_status, 'processed'),
          eq(ordersTable.refund_completed_at, null)
        )
      );

    for (const order of orders) {
      const refundId = order.refund_id;
      if (!refundId) continue;

      try {
        const refund = await razorpay.refunds.fetch(refundId);

        if (refund.status === 'processed' && refund.processed_at > 0) {
          const completedAt = new Date(refund.processed_at * 1000).toISOString();

          await db
            .update(ordersTable)
            .set({
              refund_completed_at: completedAt,
            })
            .where(eq(ordersTable.refund_id, refund.id));

          console.log(`✅ Updated refund ${refund.id} as completed`);
        } else {
          console.log(`⏳ Refund ${refund.id} status: ${refund.status}`);
        }
      } catch (err) {
        console.error(`❌ Razorpay error for refund ${refundId}:`, err.message);
      }
    }
  } catch (err) {
    console.error("❌ DB polling error:", err.message);
  }
};
