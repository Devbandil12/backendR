// file controllers/webhookController.js

import crypto from 'crypto';
import { db } from '../configs/index.js';
import { ordersTable } from '../configs/schema.js';
import { eq, or } from 'drizzle-orm'; // 🟢 ADDED 'or'
import { invalidateMultiple } from '../invalidateHelpers.js';
import {
  makeAllOrdersKey,
  makeUserOrdersKey,
  makeOrderKey,
} from '../cacheKeys.js';

const safeDate = (timestamp) => {
  return (timestamp && typeof timestamp === 'number')
    ? new Date(timestamp * 1000).toISOString()
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

  const { event, payload: { refund } = {} } = parsed;
  const entity = refund?.entity;
  if (!event.startsWith('refund.') || !entity) {
    return res.status(200).send('Ignored event');
  }

  const now = new Date().toISOString();

  try {
    // 🟢 FIX: Search by Refund ID OR Payment ID (Transaction ID)
    // This fixes the race condition where refund_id isn't in DB yet.
    const [existingOrder] = await db
      .select({
        id: ordersTable.id,
        userId: ordersTable.userId,
        refund_status: ordersTable.refund_status,
        refund_speed: ordersTable.refund_speed,
      })
      .from(ordersTable)
      .where(or(
        eq(ordersTable.refund_id, entity.id),
        eq(ordersTable.transactionId, entity.payment_id) // 👈 Fallback lookup
      ));

    if (!existingOrder) {
      console.warn(`⚠️ Order not found for refund ID: ${entity.id}`);
      // 🟢 Return 200 instead of 404 to stop Razorpay from retrying/disabling the webhook
      return res.status(200).send('Order not found (Ignored)');
    }

    let cacheNeedsInvalidation = false;

    // 🟢 IMPORTANT: Use 'existingOrder.id' for updates, NOT 'refund_id'
    // because refund_id might be null in the DB during the race condition.
    
    switch (event) {
      case 'refund.created':
        if (existingOrder.refund_status !== 'in_progress') {
          await db.update(ordersTable).set({
            refund_status: 'in_progress',
            refund_id: entity.id, // Ensure ID is saved if it was missing
            refund_initiated_at: safeDate(entity.created_at),
            refund_speed: entity.speed_processed,
            updatedAt: now,
          }).where(eq(ordersTable.id, existingOrder.id)); // 👈 Use Primary Key
          
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
        }
        break;
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