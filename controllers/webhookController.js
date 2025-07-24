// server/controllers/razorpayWebhookHandler.js
import crypto from 'crypto';
import { db } from '../configs/index.js';
import { ordersTable } from '../configs/schema.js';
import { eq } from 'drizzle-orm';

// Use bodyParser.raw({ type: 'application/json' }) on this route
const razorpayWebhookHandler = async (req, res) => {
  console.log("🔔 Razorpay Webhook invoked");

  // 1️⃣ Signature verification
  const signature = req.headers['x-razorpay-signature'];
  const secret    = process.env.RAZORPAY_WEBHOOK_SECRET;
  const bodyBuf   = req.body; // Buffer from raw parser

  const expected = crypto
    .createHmac('sha256', secret)
    .update(bodyBuf)
    .digest('hex');

  if (signature !== expected) {
    console.warn('⚠️ Invalid webhook signature');
    return res.status(400).send('Invalid signature');
  }

  // 2️⃣ Parse JSON payload
  let payload;
  try {
    payload = JSON.parse(bodyBuf.toString('utf8'));
  } catch (err) {
    console.error('❌ JSON parse error:', err);
    return res.status(400).send('Invalid JSON');
  }

  const { event, payload: { refund } = {} } = payload;
  const entity = refund?.entity;
  if (!event.startsWith('refund.') || !entity) {
    return res.status(200).send('Ignored event');
  }

  const now = new Date().toISOString();

  try {
    switch (event) {
      case 'refund.created':
        await db.update(ordersTable).set({
          refund_status:        'in_progress',
          refund_initiated_at:  new Date(entity.created_at * 1000).toISOString(),
          refund_speed:         entity.speed_processed,
          updatedAt:            now,
        }).where(eq(ordersTable.refund_id, entity.id));
        console.log(`🔄 refund.created → in_progress [${entity.id}]`);
        return res.status(200).send('refund.created handled');

      case 'refund.updated':
        await db.update(ordersTable).set({
          refund_speed: entity.speed_processed,
          updatedAt:    now,
        }).where(eq(ordersTable.refund_id, entity.id));
        console.log(`🔄 refund.updated → speed=${entity.speed_processed} [${entity.id}]`);
        return res.status(200).send('refund.updated handled');

      case 'refund.processed':
        await db.update(ordersTable).set({
          refund_status:       'processed',
          refund_completed_at: new Date(entity.processed_at * 1000).toISOString(),
          refund_speed:        entity.speed_processed,
          paymentStatus:       'refunded',
          updatedAt:           now,
        }).where(eq(ordersTable.refund_id, entity.id));
        console.log(`✅ refund.processed → processed [${entity.id}]`);
        return res.status(200).send('refund.processed handled');

      case 'refund.failed':
        await db.update(ordersTable).set({
          refund_status: 'failed',
          updatedAt:     now,
        }).where(eq(ordersTable.refund_id, entity.id));
        console.log(`❌ refund.failed → failed [${entity.id}]`);
        return res.status(200).send('refund.failed handled');

      default:
        return res.status(200).send('Event ignored');
    }

  } catch (dbErr) {
    console.error('❌ DB update error:', dbErr);
    return res.status(500).send('Database update failed');
  }
};

export default razorpayWebhookHandler;
