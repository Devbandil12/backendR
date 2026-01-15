/* eslint-disable */
// file controllers/webhookController.js

import crypto from 'crypto';
import { db } from '../configs/index.js';
import { ordersTable, usersTable, orderItemsTable } from '../configs/schema.js';
import { eq, or } from 'drizzle-orm';
import { invalidateMultiple } from '../invalidateHelpers.js';
import {
  makeAllOrdersKey,
  makeUserOrdersKey,
  makeOrderKey,
} from '../cacheKeys.js';
import { createNotification } from '../helpers/notificationManager.js';
import { processReferralCompletion } from './referralController.js'; // 🟢 IMPORT THIS

// 🔴 REMOVED: Direct email imports
// import { sendOrderConfirmationEmail, sendAdminOrderAlert } from '../routes/notifications.js';

// 🟢 ADDED: Import the Queue Producer
import { addToEmailQueue } from '../services/emailQueue.js';

import { reduceStock } from './paymentController.js';

const safeDate = (timestamp) => {
  return (timestamp && typeof timestamp === 'number')
    ? new Date(timestamp * 1000)
    : null;
};

// ... (Keep helper functions like invalidateOrderCaches, getRefundMessage unchanged) ...
const invalidateOrderCaches = async (order) => {
  if (!order || !order.id || !order.userId) return;
  await invalidateMultiple([
    { key: makeOrderKey(order.id) },
    { key: makeUserOrdersKey(order.userId) },
    { key: makeAllOrdersKey() },
  ]);
};

const getRefundMessage = (amountInPaise, speed) => {
  const amount = (amountInPaise / 100).toFixed(2);
  if (speed === 'optimum') return `Refund is complete. ₹${amount} is credited in your account shortly.`;
  return `Refund processed. ₹${amount} will be credited in your account within 5-7 working days.`;
};


const razorpayWebhookHandler = async (req, res) => {
  console.log("🔔 Razorpay Webhook invoked");

  const signature = req.headers['x-razorpay-signature'];
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const bodyBuf = req.body;

  const expected = crypto.createHmac('sha256', secret).update(bodyBuf).digest('hex');

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

  const { event, payload } = parsed;
  
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

  if (!entity) return res.status(200).send('Ignored event');

  const now = new Date();

  try {
    let existingOrder;

    if (isPaymentEvent) {
      [existingOrder] = await db.select().from(ordersTable).where(eq(ordersTable.razorpay_order_id, entity.order_id));
    } else {
      [existingOrder] = await db.select().from(ordersTable).where(or(eq(ordersTable.refund_id, entity.id), eq(ordersTable.transactionId, entity.payment_id)));
    }

    if (!existingOrder) {
      console.warn(`⚠️ Order not found for event ${event} ID: ${entity.id}`);
      return res.status(200).send('Order not found');
    }

    let cacheNeedsInvalidation = false;

    if (isPaymentEvent) {
        switch (event) {
            case 'payment.captured':
                if (existingOrder.paymentStatus !== 'paid') {
                    console.log(`💰 Webhook: Capturing payment for Order ${existingOrder.id}`);

                    try {
                        const processResult = await db.transaction(async (tx) => {
                            const [freshOrder] = await tx.select().from(ordersTable).where(eq(ordersTable.id, existingOrder.id));
                            if (freshOrder.paymentStatus === 'paid') return { status: 'ALREADY_PAID' };

                            await tx.update(ordersTable).set({
                                paymentStatus: 'paid',
                                transactionId: entity.id,
                                status: 'Order Placed',
                                updatedAt: now,
                            }).where(eq(ordersTable.id, existingOrder.id));

                            const items = await tx.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, existingOrder.id));
                            const secureCartItems = items.map(i => ({ variantId: i.variantId, quantity: i.quantity, productId: i.productId }));
                            await reduceStock(secureCartItems, tx);
                            
                            return { status: 'SUCCESS' };
                        });

                        if (processResult.status === 'ALREADY_PAID') {
                            console.log(`ℹ️ Order ${existingOrder.id} was paid concurrently. Webhook stopping.`);
                            break; 
                        }

                        console.log(`✅ Order ${existingOrder.id} marked PAID & Stock Deducted`);
                        processReferralCompletion(existingOrder.userId).catch(e => console.error("Referral Hook Fail:", e));
                        cacheNeedsInvalidation = true;

                        await createNotification(existingOrder.userId, `Order #${existingOrder.id} confirmed successfully!`, '/myorder', 'order');

                        // 🟢 THIS IS THE KEY CHANGE
                        // Instead of sending email here, we push to the Queue
                        try {
                            const [user] = await db.select().from(usersTable).where(eq(usersTable.id, existingOrder.userId));
                            const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, existingOrder.id));
                            
                            if (user && user.email) {
                                // 👇 Push to Redis Queue
                                await addToEmailQueue({
                                    userEmail: user.email,
                                    orderDetails: existingOrder,
                                    orderItems: items,
                                    paymentDetails: entity // Pass the full Razorpay entity
                                });
                                console.log(`✅ Email job queued for Order #${existingOrder.id}`);
                            }
                        } catch (emailErr) {
                            console.error("⚠️ Failed to queue email:", emailErr);
                        }
                    } catch (err) {
                        console.error("❌ Webhook Stock Reduce Failed:", err.message);
                        return res.status(500).send("Stock update failed");
                    }
                }
                break;

            case 'payment.failed':
                // ... (Existing payment failed logic - NO CHANGES NEEDED) ...
                if (existingOrder.paymentStatus !== 'failed' && existingOrder.paymentStatus !== 'paid') {
                    await db.update(ordersTable).set({
                        paymentStatus: 'failed',
                        status: 'Payment Failed',
                        updatedAt: now,
                    }).where(eq(ordersTable.id, existingOrder.id));
                    console.log(`❌ payment.failed → Order ${existingOrder.id} marked FAILED`);
                    cacheNeedsInvalidation = true;
                    await createNotification(existingOrder.userId, `Payment failed for Order #${existingOrder.id}. Please try again.`, '/myorder', 'order');
                }
                break;
        }
    }

    // ... (Existing Refund Logic - NO CHANGES NEEDED) ...
    if (isRefundEvent) {
         // ... (Keep all your existing refund switch cases exactly as they are) ...
         // Copy/paste the refund logic block from your previous file here
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
            // ... include other refund cases ...
             case 'refund.speed_changed':
                if (existingOrder.refund_speed !== entity.speed_processed) {
                    await db.update(ordersTable).set({
                        refund_speed: entity.speed_processed,
                        updatedAt: now,
                    }).where(eq(ordersTable.id, existingOrder.id));
                    console.log(`🔁 refund.speed_changed → ${entity.speed_processed}`);
                    cacheNeedsInvalidation = true;
                    if (existingOrder.refund_status === 'processed') {
                        const msg = getRefundMessage(entity.amount, entity.speed_processed);
                        await createNotification(existingOrder.userId, msg, '/myorder', 'order');
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
                    const msg = getRefundMessage(entity.amount, entity.speed_processed);
                    await createNotification(existingOrder.userId, msg, '/myorder', 'order');
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
                    await createNotification(existingOrder.userId, `Refund for order #${existingOrder.id} failed.`, '/myorder', 'order');
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