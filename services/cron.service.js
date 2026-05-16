import cron from 'node-cron';
import { db } from '../configs/index.js';
import { addToCartTable, ordersTable, orderTimeline } from '../configs/schema.js';
import { executeRecoveryForUsers } from '../routes/notifications.js';
import { and, eq, lte, isNull } from 'drizzle-orm';
import { createShiprocketOrderForExistingOrder } from '../controllers/paymentController.js';
import { invalidateMultiple } from '../invalidateHelpers.js';
import { makeAllOrdersKey, makeOrderKey, makeUserOrdersKey } from '../cacheKeys.js';

export const initCronJobs = () => {
    console.log("⏰ Initializing Cron Jobs...");

    // Schedule: Runs at 10:00 AM on the 1st and 15th of every month
    // Syntax: 'Minute Hour DayOfMonth Month DayOfWeek'
    cron.schedule('0 10 1,15 * *', async () => {
        console.log("🔔 [AUTO] Running Bi-Weekly Abandoned Cart Recovery...");

        try {
            // 1. Find all distinct users who have items in the cart
            const usersWithCarts = await db
                .selectDistinct({ id: addToCartTable.userId })
                .from(addToCartTable);

            const userIds = usersWithCarts.map(u => u.id);

            if (userIds.length > 0) {
                console.log(`🎯 Found ${userIds.length} users with abandoned carts. Sending notifications...`);
                // 2. Call the shared logic
                await executeRecoveryForUsers(userIds);
                console.log("✅ [AUTO] Recovery Batch Complete.");
            } else {
                console.log("ℹ️ No abandoned carts found today.");
            }

        } catch (error) {
            console.error("❌ [AUTO] Cron Job Failed:", error);
        }
    });

    // 🟢 New: Every 30 minutes, process orders older than 6 hours
    // Flow:
    // - Find orders with status 'Order Placed', no Shiprocket IDs, createdAt <= now - 6h
    // - Mark them as 'Processing' + timeline entry
    // - Trigger Shiprocket order creation
    cron.schedule('*/30 * * * *', async () => {
        console.log("🚚 [AUTO] Checking for orders to move to Processing & create Shiprocket shipments...");

        try {
            const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);

            const candidates = await db
                .select()
                .from(ordersTable)
                .where(
                    and(
                        eq(ordersTable.status, 'Order Placed'),
                        lte(ordersTable.createdAt, sixHoursAgo),
                        isNull(ordersTable.shiprocketOrderId),
                        isNull(ordersTable.shiprocketShipmentId)
                    )
                );

            if (!candidates.length) {
                console.log("ℹ️ No pending orders eligible for Processing/Shiprocket this run.");
                return;
            }

            console.log(`🎯 Found ${candidates.length} orders to process for Shiprocket creation.`);

            for (const order of candidates) {
                try {
                    await db.transaction(async (tx) => {
                        // Update status -> Processing
                        await tx
                            .update(ordersTable)
                            .set({
                                status: 'Processing',
                                progressStep: 2,
                                updatedAt: new Date(),
                            })
                            .where(eq(ordersTable.id, order.id));

                        // Add timeline event
                        await tx.insert(orderTimeline).values({
                            orderId: order.id,
                            status: 'Processing',
                            title: 'Order Processing',
                            description: 'Order moved to processing and queued for shipment booking.',
                            timestamp: new Date(),
                        });
                    });

                    // Trigger Shiprocket order creation (best-effort, async)
                    await createShiprocketOrderForExistingOrder(order.id);

                    // Invalidate caches
                    await invalidateMultiple([
                        { key: makeAllOrdersKey() },
                        { key: makeOrderKey(order.id) },
                        { key: makeUserOrdersKey(order.userId) },
                    ]);

                    console.log(`✅ Processed order ${order.id} -> Processing + Shiprocket.`);
                } catch (orderErr) {
                    console.error(`❌ Failed to process order ${order.id} in cron:`, orderErr);
                }
            }
        } catch (err) {
            console.error("❌ [AUTO] Processing/Shiprocket cron failed:", err);
        }
    });
};