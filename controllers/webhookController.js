/* eslint-disable */
// file controllers/webhookController.js

import crypto from 'crypto';
import { db } from '../configs/index.js';
// 🟢 UPDATED: Imported usersTable and orderItemsTable for email logic
import { ordersTable, usersTable, orderItemsTable } from '../configs/schema.js';
import { eq, or } from 'drizzle-orm';
import { invalidateMultiple } from '../invalidateHelpers.js';
import {
  makeAllOrdersKey,
  makeUserOrdersKey,
  makeOrderKey,
} from '../cacheKeys.js';
import { createNotification } from '../helpers/notificationManager.js';
// 🟢 UPDATED: Import the Email Helper
import { sendOrderConfirmationEmail, sendAdminOrderAlert } from '../routes/notifications.js';
// 🟢 IMPORT REDUCE STOCK (The Fix)
import { reduceStock } from './paymentController.js';

// 🟢 FIX: Return a Date object, not a string. Drizzle handles the conversion.
const safeDate = (timestamp) => {
  return (timestamp && typeof timestamp === 'number')
    ? new Date(timestamp * 1000)
    : null;
};

// Helper to invalidate order caches
const invalidateOrderCaches = async (order) => {
  if (!order || !order.id || !order.userId) return;
  await invalidateMultiple([
    { key: makeOrderKey(order.id) },
    { key: makeUserOrdersKey(order.userId) },
    { key: makeAllOrdersKey() },
  ]);
};

// Generates the exact message used in UI
const getRefundMessage = (amountInPaise, speed) => {
  const amount = (amountInPaise / 100).toFixed(2);
  
  if (speed === 'optimum') {
    return `Refund is complete. ₹${amount} is credited in your account shortly.`;
  }
  
  // Default / Normal speed message
  return `Refund processed. ₹${amount} will be credited in your account within 5-7 working days.`;
};

const razorpayWebhookHandler = async (req, res) => {
  console.log("🔔 Razorpay Webhook invoked");

  const signature = req.headers['x-razorpay-signature'];
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const bodyBuf = req.body;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(bodyBuf)
    .digest('hex');

  if (signature !== expected) {
    console.warn('⚠️ Invalid webhook signature');
    return res.status(400).send('Invalid signature');
  }

  let parsed;
  try {
    parsed = JSON.parse(bodyBuf.toString('utf8'));
  } catch (err) {
    console.error('❌ JSON parse error:', err);
    return res.status(400).send('Invalid JSON');
  }

  // 🟢 UPDATED: Handle both Payment and Refund payloads
  const { event, payload } = parsed;
  
  // Determine if this is a payment or refund entity
  let entity;
  let isPaymentEvent = false;
  let isRefundEvent = false;

  if (event.startsWith('payment.') && payload.payment) {
    entity = payload.payment.entity;
    isPaymentEvent = true;
  } else if (event.startsWith('refund.') && payload.refund) {
    entity = payload.refund.entity;
    isRefundEvent = true;
  }

  if (!entity) {
    return res.status(200).send('Ignored event (No entity found)');
  }

  // 🟢 FIX: Use Date object for 'updatedAt', not a string
  const now = new Date();

  try {
    let existingOrder;

    // 🟢 UPDATED: Search Logic based on Event Type
    if (isPaymentEvent) {
      // For payments, we look up by the Razorpay Order ID
      [existingOrder] = await db
        .select()
        .from(ordersTable)
        .where(eq(ordersTable.razorpay_order_id, entity.order_id));
    } else {
      // For refunds (Existing Logic), search by Refund ID OR Transaction ID
      [existingOrder] = await db
        .select()
        .from(ordersTable)
        .where(or(
          eq(ordersTable.refund_id, entity.id),
          eq(ordersTable.transactionId, entity.payment_id)
        ));
    }

    if (!existingOrder) {
      // It is common for "payment.captured" to fire before the UI creates the order 
      // if the UI is slow. In a perfect system, we might retry, but returning 200 is safe to stop loops.
      console.warn(`⚠️ Order not found for event ${event} ID: ${entity.id}`);
      return res.status(200).send('Order not found (Ignored)');
    }

    let cacheNeedsInvalidation = false;

    // 🟢 NEW: Payment Logic (The Zero-Downtime Safety Net)
    if (isPaymentEvent) {
        switch (event) {
case 'payment.captured':
                // Only update if it's NOT already paid (Idempotency)
                if (existingOrder.paymentStatus !== 'paid') {
                    console.log(`💰 Webhook: Capturing payment for Order ${existingOrder.id}`);

                    try {
                        // 🟢 USE A VARIABLE TO TRACK IF WE ACTUALLY UPDATED
                        const processResult = await db.transaction(async (tx) => {
                            // 🛑 1. SAFETY CHECK (The Fix)
                            // Fetch the order AGAIN inside the transaction to ensure no one else paid it just now.
                            const [freshOrder] = await tx
                                .select()
                                .from(ordersTable)
                                .where(eq(ordersTable.id, existingOrder.id));

                            if (freshOrder.paymentStatus === 'paid') {
                                return { status: 'ALREADY_PAID' };
                            }

                            // 2. Mark Paid
                            await tx.update(ordersTable).set({
                                paymentStatus: 'paid',
                                transactionId: entity.id,
                                status: 'Order Placed',
                                updatedAt: now,
                            }).where(eq(ordersTable.id, existingOrder.id));

                            // 3. Fetch Items & Reduce Stock
                            const items = await tx.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, existingOrder.id));
                            const secureCartItems = items.map(i => ({ 
                                variantId: i.variantId, 
                                quantity: i.quantity, 
                                productId: i.productId 
                            }));

                            await reduceStock(secureCartItems, tx);
                            
                            return { status: 'SUCCESS' };
                        });

                        // 🛑 4. STOP IF ALREADY PAID
                        if (processResult.status === 'ALREADY_PAID') {
                            console.log(`ℹ️ Order ${existingOrder.id} was paid concurrently. Webhook stopping.`);
                            break; // Exit the switch case, do not send email
                        }

                        // --- Success Logic (Only runs if WE updated the order) ---
                        console.log(`✅ Order ${existingOrder.id} marked PAID & Stock Deducted`);
                        cacheNeedsInvalidation = true;

                        // 5. Send Notifications (No Duplicates now)
                        await createNotification(
                            existingOrder.userId, 
                            `Order #${existingOrder.id} confirmed successfully!`, 
                            '/myorder', 
                            'order'
                        );

                        try {
                            const [user] = await db.select().from(usersTable).where(eq(usersTable.id, existingOrder.userId));
                            const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, existingOrder.id));
                            
                            if (user && user.email) {
                               await sendOrderConfirmationEmail(user.email, existingOrder, items);
                               await sendAdminOrderAlert(existingOrder, items);
                            }
                        } catch (emailErr) {
                            console.error("⚠️ Failed to send email from webhook:", emailErr);
                        }

                    } catch (err) {
                        console.error("❌ Webhook Stock Reduce Failed:", err.message);
                        return res.status(500).send("Stock update failed");
                    }
                }
                break;

            case 'payment.failed':
                if (existingOrder.paymentStatus !== 'failed' && existingOrder.paymentStatus !== 'paid') {
                    await db.update(ordersTable).set({
                        paymentStatus: 'failed',
                        status: 'Payment Failed',
                        updatedAt: now,
                    }).where(eq(ordersTable.id, existingOrder.id));
                    
                    console.log(`❌ payment.failed → Order ${existingOrder.id} marked FAILED`);
                    cacheNeedsInvalidation = true;

                    await createNotification(
                        existingOrder.userId, 
                        `Payment failed for Order #${existingOrder.id}. Please try again.`, 
                        '/myorder', 
                        'order'
                    );
                }
                break;
        }
    }

    // 🟢 EXISTING: Refund Logic (Unchanged Logic, just wrapped in check)
    if (isRefundEvent) {
        switch (event) {
        case 'refund.created':
            if (existingOrder.refund_status !== 'in_progress') {
            await db.update(ordersTable).set({
                refund_status: 'in_progress',
                refund_id: entity.id,
                refund_initiated_at: safeDate(entity.created_at),
                refund_speed: entity.speed_processed,
                updatedAt: now,
            }).where(eq(ordersTable.id, existingOrder.id));
            
            console.log(`🔄 refund.created → in_progress [${entity.id}]`);
            cacheNeedsInvalidation = true;
            }
            break;

        case 'refund.speed_changed':
            if (existingOrder.refund_speed !== entity.speed_processed) {
            await db.update(ordersTable).set({
                refund_speed: entity.speed_processed,
                updatedAt: now,
            }).where(eq(ordersTable.id, existingOrder.id));

            console.log(`🔁 refund.speed_changed → ${entity.speed_processed}`);
            cacheNeedsInvalidation = true;

            // Notification: Only if refund was ALREADY processed
            if (existingOrder.refund_status === 'processed') {
                const msg = getRefundMessage(entity.amount, entity.speed_processed);
                await createNotification(existingOrder.userId, msg, '/myorder', 'order');
                console.log(`📩 Notification sent for speed update: ${entity.speed_processed}`);
            }
            }
            break;

        case 'refund.processed':
            if (existingOrder.refund_status !== 'processed') {
            await db.update(ordersTable).set({
                refund_status: 'processed',
                refund_completed_at: safeDate(entity.processed_at),
                refund_speed: entity.speed_processed,
                paymentStatus: 'refunded',
                updatedAt: now,
            }).where(eq(ordersTable.id, existingOrder.id));

            console.log(`✅ refund.processed → processed [${entity.id}]`);
            cacheNeedsInvalidation = true;

            // Notification: Send when refund completes
            const msg = getRefundMessage(entity.amount, entity.speed_processed);
            await createNotification(existingOrder.userId, msg, '/myorder', 'order');
            console.log(`📩 Notification sent for processed refund`);
            }
            break;

        case 'refund.failed':
            if (existingOrder.refund_status !== 'failed') {
            await db.update(ordersTable).set({
                refund_status: 'failed',
                updatedAt: now,
            }).where(eq(ordersTable.id, existingOrder.id));

            console.log(`❌ refund.failed → failed [${entity.id}]`);
            cacheNeedsInvalidation = true;

            // Notification: Optional failure message
            await createNotification(
                existingOrder.userId, 
                `Refund for order #${existingOrder.id} failed. Please contact support.`, 
                '/myorder', 
                'order'
            );
            }
            break;
        }
    }

    if (cacheNeedsInvalidation) {
      await invalidateOrderCaches(existingOrder);
    }

    return res.status(200).send(`Handled ${event}`);
  } catch (dbErr) {
    console.error('❌ DB error:', dbErr.message);
    return res.status(500).send('Webhook DB update failed');
  }
};

export default razorpayWebhookHandler;