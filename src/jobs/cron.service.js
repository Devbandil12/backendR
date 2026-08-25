import cron from 'node-cron';
import { db } from '../db/client.js';
import { addToCartTable, ordersTable, orderTimeline } from '../db/schema/index.js';
import { executeRecoveryForUsers } from '../modules/notifications/notifications.service.js';
import { and, eq, lte, isNull, sql } from 'drizzle-orm';
import { createShiprocketOrderForExistingOrder } from '../modules/payments/payments.service.js';
import { invalidateMultiple } from '../infrastructure/cache/invalidateHelpers.js';
import { makeAllOrdersKey, makeOrderKey, makeUserOrdersKey } from '../infrastructure/cache/cacheKeys.js';
import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

async function sendSLABreachEmail(ticket, type) {
  try {
    if (!process.env.EMAIL_USER) return;
    await transporter.sendMail({
      from: `"Devid Aura SLA Alert" <${process.env.EMAIL_USER}>`,
      to: process.env.EMAIL_USER,
      subject: `🚨 SLA Breach Alert: Ticket ${ticket.ticketNumber} (${ticket.priority})`,
      text: `The ticket ${ticket.ticketNumber} has breached its ${type} SLA target!\n\nSubject: ${ticket.subject}\nPriority: ${ticket.priority}\nStatus: ${ticket.status}\nCustomer: ${ticket.guestEmail || 'Registered User'}\n\nPlease assign an agent and resolve immediately.\n\n- Devid Aura SLA Engine`,
    });
  } catch (err) {
    console.error('⚠️ Failed to send SLA breach email:', err.message);
  }
}

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

    // 🟢 UPDATED (Part B): window extended from a hardcoded 5 minutes to
    // ORDER_CANCEL_WINDOW_MINUTES (default 60) — this is now the same
    // number customers are shown as their free-cancellation deadline, so
    // the promise and the mechanism can never drift apart.
    // Flow:
    // - Find orders with status 'Order Placed', no Shiprocket IDs, createdAt <= now - window
    // - Mark them as 'Processing' + timeline entry
    // - Trigger Shiprocket order creation
    // - Rollback to 'Order Placed' if Shiprocket fails so it can be retried
    cron.schedule('*/5 * * * *', async () => {
        console.log("🚚 [AUTO] Checking for orders to move to Processing & create Shiprocket shipments...");

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
                    console.error(`❌ Failed to process order ${order.id} in cron. Rolling back:`, orderErr);
                    
                    // 🛑 CRITICAL FIX: Roll back to 'Order Placed' on failure so it can be retried
                    try {
                        await db.transaction(async (tx) => {
                            await tx
                                .update(ordersTable)
                                .set({
                                    status: 'Order Placed',
                                    progressStep: 1,
                                    updatedAt: new Date(),
                                })
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
            console.error("❌ [AUTO] Processing/Shiprocket cron failed:", err);
        }
    });

    // 🟢 SLA Breach Verification Cron
    // Runs every 5 minutes
    cron.schedule('*/5 * * * *', async () => {
        const { redis } = await import('../config/redis.js');
        // Redis lock to prevent multiple worker nodes from running this concurrently
        const lockKey = 'lock:cron:sla-breach';
        const acquired = await redis.set(lockKey, 'locked', 'NX', 'EX', 240); // 4 min lock
        if (!acquired) {
            console.log("ℹ️ [SLA] Cron skipped — locked by another node.");
            return;
        }

        console.log("⏰ [SLA] Scanning for SLA breaches...");
        const now = new Date();
        try {
            const crypto = await import('crypto');
            const { ticketsTable, ticketEventsTable, ticketMessagesTable, outboxTable } = await import('../db/schema/index.js');
            const { isNull, and, eq, lte, sql } = await import('drizzle-orm');
            
            // 1. First Response Breaches
            const responseBreaches = await db
                .select()
                .from(ticketsTable)
                .where(
                    and(
                        isNull(ticketsTable.deletedAt),
                        isNull(ticketsTable.firstResponseAt),
                        eq(ticketsTable.isFirstResponseBreached, false),
                        lte(ticketsTable.firstResponseDueAt, now)
                    )
                );
                
            for (const ticket of responseBreaches) {
                console.warn(`🚨 [SLA] Ticket ${ticket.ticketNumber} breached Response SLA!`);
                await db.transaction(async (tx) => {
                    await tx.update(ticketsTable)
                        .set({ isFirstResponseBreached: true, updatedAt: now })
                        .where(eq(ticketsTable.id, ticket.id));
                        
                    await tx.insert(ticketEventsTable).values({
                        ticketId: ticket.id,
                        eventType: 'SLA_BREACHED',
                        toValue: 'Response Breached',
                        metadata: { priority: ticket.priority, dueAt: ticket.firstResponseDueAt },
                    });
                    
                    await tx.insert(ticketMessagesTable).values({
                        ticketId: ticket.id,
                        senderRole: 'system',
                        messageType: 'system_event',
                        message: `SLA Alert: First Response SLA breached for this ${ticket.priority} ticket.`,
                    });

                    await tx.insert(outboxTable).values({
                        id: crypto.randomUUID(),
                        eventType: 'SLA_BREACHED',
                        payload: { ticket, breachType: 'Response' },
                    });
                });
            }

            // 2. Resolution Breaches
            const resolutionBreaches = await db
                .select()
                .from(ticketsTable)
                .where(
                    and(
                        isNull(ticketsTable.deletedAt),
                        isNull(ticketsTable.resolvedAt),
                        eq(ticketsTable.isResolutionBreached, false),
                        lte(ticketsTable.resolutionDueAt, now),
                        sql`${ticketsTable.status} NOT IN ('resolved', 'closed', 'spam')`
                    )
                );
                
            for (const ticket of resolutionBreaches) {
                console.warn(`🚨 [SLA] Ticket ${ticket.ticketNumber} breached Resolution SLA!`);
                await db.transaction(async (tx) => {
                    await tx.update(ticketsTable)
                        .set({ isResolutionBreached: true, updatedAt: now })
                        .where(eq(ticketsTable.id, ticket.id));
                        
                    await tx.insert(ticketEventsTable).values({
                        ticketId: ticket.id,
                        eventType: 'SLA_BREACHED',
                        toValue: 'Resolution Breached',
                        metadata: { priority: ticket.priority, dueAt: ticket.resolutionDueAt },
                    });
                    
                    await tx.insert(ticketMessagesTable).values({
                        ticketId: ticket.id,
                        senderRole: 'system',
                        messageType: 'system_event',
                        message: `SLA Alert: Resolution SLA breached for this ${ticket.priority} ticket.`,
                    });

                    await tx.insert(outboxTable).values({
                        id: crypto.randomUUID(),
                        eventType: 'SLA_BREACHED',
                        payload: { ticket, breachType: 'Resolution' },
                    });
                });
            }
            
        } catch (err) {
            console.error("❌ [SLA] Cron Job Failed:", err);
        }
    });
};
