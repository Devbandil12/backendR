// refundPoller.js

import 'dotenv/config';
import Razorpay from 'razorpay';
import { db } from '../src/configs/index.js';
import { ordersTable } from '../src/configs/schema.js';
import { eq, and, isNotNull, not } from 'drizzle-orm';

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_ID_KEY,
  key_secret: process.env.RAZORPAY_SECRET_KEY,
});

export const pollRefunds = async () => {
  console.log("🔄 Polling: Checking Razorpay refund statuses...");

  try {
    const pending = await db
      .select({
        id: ordersTable.id,
        refundId: ordersTable.refund_id,
      })
      .from(ordersTable)
      .where(
        and(
          isNotNull(ordersTable.refund_id),
          not(eq(ordersTable.refund_status, 'processed'))
        )
      );

    for (const order of pending) {
      const { refundId, id: orderId } = order;
      if (!refundId) continue;

      try {
        const refund = await razorpay.refunds.fetch(refundId);

        if (refund.status === 'processed') {
          const completedAt = refund.processed_at
            ? new Date(refund.processed_at * 1000).toISOString()
            : new Date().toISOString();

          await db
            .update(ordersTable)
            .set({
              refund_status: 'processed',
              refund_completed_at: completedAt,
              refund_speed: refund.speed_processed || null,
              paymentStatus: 'refunded',
            })
            .where(eq(ordersTable.refund_id, refund.id));

          console.log(`✅ Refund ${refund.id} for order ${orderId} finalized`);
        } else {
          console.log(`⏳ Refund ${refund.id} still ${refund.status}`);
        }
      } catch (err) {
        console.error(`❌ Error fetching refund ${refundId}:`, err.message);
      }
    }
  } catch (err) {
    console.error("❌ Polling DB error:", err.message);
  }
};
