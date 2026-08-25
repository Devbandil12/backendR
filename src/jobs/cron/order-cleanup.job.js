// src/jobs/cron/order-cleanup.job.js
// Moved from: jobs/cron.service.js (Shiprocket order processing section)

import { db } from '../../db/client.js';
import { ordersTable } from '../../db/schema/orders.schema.js';
import { orderTimeline } from '../../db/schema/orders.schema.js';
import { and, eq, lte, isNull } from 'drizzle-orm';
import { invalidateMultiple } from '../../infrastructure/cache/cache.invalidate.js';
import {
  makeAllOrdersKey,
  makeOrderKey,
  makeUserOrdersKey,
} from '../../infrastructure/cache/cache.keys.js';

// createShiprocketOrderForExistingOrder lives in modules/payments/payments.service.js
import { createShiprocketOrderForExistingOrder } from '../../modules/payments/payments.service.js';

export const runOrderCleanupJob = async () => {
  console.log('🚚 [AUTO] Checking for orders to move to Processing & create Shiprocket shipments...');

  try {
    const cancelWindowMinutes = Number(process.env.ORDER_CANCEL_WINDOW_MINUTES || 60);
    const windowAgo = new Date(Date.now() - cancelWindowMinutes * 60 * 1000);

    const candidates = await db
      .select()
      .from(ordersTable)
      .where(
        and(
          eq(ordersTable.status, 'Order Placed'),
          lte(ordersTable.createdAt, windowAgo),
          isNull(ordersTable.shiprocketOrderId),
          isNull(ordersTable.shiprocketShipmentId)
        )
      );

    if (!candidates.length) {
      console.log('ℹ️ No pending orders eligible for Processing/Shiprocket this run.');
      return;
    }

    console.log(`🎯 Found ${candidates.length} orders to process for Shiprocket creation.`);

    for (const order of candidates) {
      try {
        await db.transaction(async (tx) => {
          await tx
            .update(ordersTable)
            .set({ status: 'Processing', progressStep: 2, updatedAt: new Date() })
            .where(eq(ordersTable.id, order.id));

          await tx.insert(orderTimeline).values({
            orderId: order.id,
            status: 'Processing',
            title: 'Order Processing',
            description: 'Order moved to processing and queued for shipment booking.',
            timestamp: new Date(),
          });
        });

        await createShiprocketOrderForExistingOrder(order.id);

        await invalidateMultiple([
          { key: makeAllOrdersKey() },
          { key: makeOrderKey(order.id) },
          { key: makeUserOrdersKey(order.userId) },
        ]);

        console.log(`✅ Processed order ${order.id} -> Processing + Shiprocket.`);
      } catch (orderErr) {
        console.error(`❌ Failed to process order ${order.id}:`, orderErr);

        try {
          await db.transaction(async (tx) => {
            await tx
              .update(ordersTable)
              .set({ status: 'Order Placed', progressStep: 1, updatedAt: new Date() })
              .where(eq(ordersTable.id, order.id));

            await tx.insert(orderTimeline).values({
              orderId: order.id,
              status: 'Order Placed',
              title: 'Fulfillment Delayed',
              description: 'Attempt to assign a courier failed. The system will automatically retry shortly.',
              timestamp: new Date(),
            });
          });
        } catch (rollbackErr) {
          console.error(`🚨 FATAL: Failed to rollback order ${order.id}:`, rollbackErr);
        }
      }
    }
  } catch (err) {
    console.error('❌ [AUTO] Processing/Shiprocket cron failed:', err);
  }
};
