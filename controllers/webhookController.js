// server/controllers/razorpayWebhookHandler.js
import crypto from 'crypto';
import { db } from '../configs/index.js';
import { ordersTable } from '../configs/schema.js';
import { eq } from 'drizzle-orm';

const safeDate = (timestamp) => {
  return (timestamp && typeof timestamp === 'number')
    ? new Date(timestamp * 1000).toISOString()
    : null;
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
    switch (event) {
      case 'refund.created':
        await db.update(ordersTable).set({
          refund_status: 'in_progress',
          refund_initiated_at: safeDate(entity.created_at),
          refund_speed: entity.speed_processed,
          updatedAt: now,
        }).where(eq(ordersTable.refund_id, entity.id));
        console.log(`🔄 refund.created → in_progress [${entity.id}]`);
        break;

      case 'refund.speed_changed':
        await db.update(ordersTable).set({
          refund_speed: entity.speed_processed,
          updatedAt: now,
        }).where(eq(ordersTable.refund_id, entity.id));
        console.log(`🔁 refund.speed_changed → ${entity.speed_processed} [${entity.id}]`);
        break;

      case 'refund.processed':
        await db.update(ordersTable).set({
          refund_status: 'processed',
          refund_completed_at: safeDate(entity.processed_at),
          refund_speed: entity.speed_processed,
          paymentStatus: 'refunded',
          updatedAt: now,
        }).where(eq(ordersTable.refund_id, entity.id));
        console.log(`✅ refund.processed → processed [${entity.id}]`);
        break;

      case 'refund.failed':
        await db.update(ordersTable).set({
          refund_status: 'failed',
          updatedAt: now,
        }).where(eq(ordersTable.refund_id, entity.id));
        console.log(`❌ refund.failed → failed [${entity.id}]`);
        break;

      default:
        console.log(`ℹ️ Event ignored: ${event}`);
    }

    return res.status(200).send(`Handled ${event}`);
  } catch (dbErr) {
    console.error('❌ DB error:', dbErr.message);
    return res.status(500).send('Webhook DB update failed');
  }
};

export default razorpayWebhookHandler;
