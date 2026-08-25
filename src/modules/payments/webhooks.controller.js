/* eslint-disable */
// file controllers/webhookController.js

import crypto from 'crypto';
import { db } from '../../db/client.js';
import { ordersTable, usersTable, orderItemsTable, orderTimeline } from '../../db/schema/index.js'; // 🟢 ADDED orderTimeline
import { eq, or } from 'drizzle-orm';
import { invalidateMultiple } from '../../infrastructure/cache/cache.invalidate.js';
import {
  makeAllOrdersKey,
  makeUserOrdersKey,
  makeOrderKey,
} from '../../infrastructure/cache/cache.keys.js';
import { createNotification } from '../../modules/notifications/notifications.service.js';
import { safeCompare } from '../../utils/safeCompare.js'; // 🟢 FIX: timing-safe signature comparison
import { processReferralCompletion } from '../referrals/referrals.controller.js'; 

// 🟢 ADDED: Import the Queue Producer
import { addToEmailQueue } from '../../infrastructure/queues/email.queue.js';

import { reduceStock } from './payments.service.js';

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

  if (!safeCompare(signature, expected)) {
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
      const [existingRefundRecord] = await db.select().from(refundsTable).where(eq(refundsTable.gatewayRefundId, entity.id)).limit(1);
      if (existingRefundRecord) {
        [existingOrder] = await db.select().from(ordersTable).where(eq(ordersTable.id, existingRefundRecord.orderId));
      } else if (entity.payment_id) {
        [existingOrder] = await db.select().from(ordersTable).where(eq(ordersTable.transactionId, entity.payment_id));
      }
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
                            if (freshOrder.paymentStatus === 'paid') return { alreadyPaid: true };

                            const [updatedOrder] = await tx.update(ordersTable).set({
                                paymentStatus: 'paid',
                                updatedAt: now,
                            }).where(eq(ordersTable.id, existingOrder.id)).returning();

                            await tx.insert(orderTimeline).values({
                                orderId: existingOrder.id,
                                status: 'Order Placed',
                                title: 'Payment Confirmed',
                                description: `Payment of ₹${existingOrder.totalAmount} was successfully verified via Webhook.`,
                                timestamp: new Date()
                            });

                            return { updatedOrder };
                        });

                        if (processResult.alreadyPaid) {
                            console.log(`ℹ️ Webhook: Order ${existingOrder.id} already marked as paid. Skipping.`);
                            return res.status(200).send('OK (Already Processed)');
                        }

                        cacheNeedsInvalidation = true;

                        try {
                            const shiprocketPayload = await buildShiprocketPayload(existingOrder.id, existingOrder);
                            const shiprocketRes = await createCustomShiprocketOrder(shiprocketPayload);

                            if (shiprocketRes && shiprocketRes.order_id) {
                                await db.update(ordersTable).set({
                                    shiprocketOrderId: String(shiprocketRes.order_id),
                                    shiprocketShipmentId: String(shiprocketRes.shipment_id || ''),
                                    awbCode: shiprocketRes.awb_code || null,
                                    courierName: shiprocketRes.courier_name || null,
                                    updatedAt: new Date()
                                }).where(eq(ordersTable.id, existingOrder.id));

                                console.log(`🚀 Webhook: Shiprocket order created successfully: ${shiprocketRes.order_id}`);
                            }
                        } catch (srErr) {
                            console.error(`⚠️ Webhook: Failed to auto-create Shiprocket order for ${existingOrder.id}:`, srErr.message);
                        }

                        await createNotification(
                            existingOrder.userId,
                            `Payment of ₹${existingOrder.totalAmount} for Order #${existingOrder.id} received!`,
                            '/myorder',
                            'order'
                        );
                    } catch (txErr) {
                        console.error(`❌ Webhook: Failed to complete payment.captured for Order ${existingOrder.id}:`, txErr);
                        return res.status(500).send('Failed to process payment.captured');
                    }
                }
                break;

            case 'payment.failed':
                if (existingOrder.paymentStatus !== 'failed') {
                    await db.transaction(async (tx) => {
                        await tx.update(ordersTable).set({
                            paymentStatus: 'failed',
                            updatedAt: now,
                        }).where(eq(ordersTable.id, existingOrder.id));

                        await tx.insert(orderTimeline).values({
                            orderId: existingOrder.id,
                            status: 'Payment Failed',
                            title: 'Payment Failed',
                            description: 'Payment transaction failed or was declined by user.',
                            timestamp: new Date()
                        });
                    });
                    console.log(`❌ payment.failed → failed [${entity.id}]`);
                    cacheNeedsInvalidation = true;
                    await createNotification(existingOrder.userId, `Payment for order #${existingOrder.id} failed.`, '/myorder', 'order');
                }
                break;
        }
    }

    if (isRefundEvent) {
          const { syncRazorpayRefundEntity } = await import('../orders/refunds.compatibility.js');
          const [existingRefundRecord] = await db.select().from(refundsTable).where(eq(refundsTable.gatewayRefundId, entity.id)).limit(1);

          switch (event) {
            case 'refund.created':
                if (!existingRefundRecord || existingRefundRecord.refundStatus !== 'in_progress') {
                    await syncRazorpayRefundEntity({ orderId: existingOrder.id, entity });
                    console.log(`🔄 refund.created → in_progress [${entity.id}]`);
                    cacheNeedsInvalidation = true;
                }
                break;
             case 'refund.speed_changed':
                if (!existingRefundRecord || existingRefundRecord.refundSpeed !== entity.speed_processed) {
                    await syncRazorpayRefundEntity({ orderId: existingOrder.id, entity });
                    console.log(`🔁 refund.speed_changed → ${entity.speed_processed}`);
                    cacheNeedsInvalidation = true;
                    if (existingRefundRecord?.refundStatus === 'processed') {
                        const msg = getRefundMessage(entity.amount, entity.speed_processed);
                        await createNotification(existingOrder.userId, msg, '/myorder', 'order');
                    }
                }
                break;
            case 'refund.processed':
                if (!existingRefundRecord || existingRefundRecord.refundStatus !== 'processed') {
                    await db.transaction(async (tx) => {
                        await syncRazorpayRefundEntity({ orderId: existingOrder.id, entity, tx });

                        await tx.insert(orderTimeline).values({
                            orderId: existingOrder.id,
                            status: 'Refunded',
                            title: 'Refund Processed',
                            description: `Refund of ₹${(entity.amount/100).toFixed(2)} processed successfully via Webhook.`,
                            timestamp: new Date()
                        });
                    });
                    
                    console.log(`✅ refund.processed → processed [${entity.id}]`);
                    cacheNeedsInvalidation = true;
                    const msg = getRefundMessage(entity.amount, entity.speed_processed);
                    await createNotification(existingOrder.userId, msg, '/myorder', 'order');
                }
                break;
            case 'refund.failed':
                if (!existingRefundRecord || existingRefundRecord.refundStatus !== 'failed') {
                    await db.transaction(async (tx) => {
                        await syncRazorpayRefundEntity({ orderId: existingOrder.id, entity, tx });

                        await tx.insert(orderTimeline).values({
                            orderId: existingOrder.id,
                            status: 'Refund Failed',
                            title: 'Refund Failed',
                            description: 'The refund attempt failed. Please contact support.',
                            timestamp: new Date()
                        });
                    });
                    
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
