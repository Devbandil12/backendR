import crypto from 'crypto';
import { db } from '../configs/index.js';
import { ordersTable } from '../configs/schema.js';
import { eq } from 'drizzle-orm';

const razorpayWebhookHandler = async (req, res) => {
  console.log("🔔 Webhook handler invoked");

  const signature = req.headers['x-razorpay-signature'];
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const body = req.body;

  // Verify signature
  const expected = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');

  if (signature !== expected) {
    console.warn('⚠️ Invalid webhook signature');
    return res.status(400).send('Invalid signature');
  }

  let parsedBody;
  try {
    parsedBody = JSON.parse(body.toString());
  } catch (err) {
    console.error("❌ Failed to parse JSON from webhook:", err);
    return res.status(400).send("Invalid JSON body");
  }

  const { event, payload } = parsedBody;

  if (!event.startsWith('refund.')) {
    return res.status(200).send('Ignored event');
  }

  const entity = payload?.refund?.entity;
  if (!entity) {
    return res.status(400).send("Missing refund entity");
  }

  // Safely convert processed_at timestamp
  let refundCompletedAt = null;
  if (entity.status === 'processed' && entity.processed_at) {
    try {
      refundCompletedAt = new Date(entity.processed_at * 1000);
    } catch (e) {
      console.warn("⚠️ Invalid processed_at timestamp:", entity.processed_at);
    }
  }

  const updates = {
  refund_status: entity.status,
  refund_completed_at: refundCompletedAt,
  refund_speed: entity.speed_processed, // <- capture refund speed here too
  updatedAt: new Date().toISOString(),
};


  if (entity.status === 'processed') {
    updates.paymentStatus = 'refunded';
    updates.status = 'Order Cancelled';
  } else if (entity.status === 'failed') {
    console.warn(`⚠️ Refund failed for refund_id: ${entity.id}`);
  }

  try {
    const updated = await db
      .update(ordersTable)
      .set(updates)
      .where(eq(ordersTable.refund_id, entity.id));

    console.log("✅ Refund update saved:", entity.id);
    return res.status(200).send("Webhook processed");
  } catch (err) {
    console.error("❌ DB error:", err);
    return res.status(500).send("Database update failed");
  }
};

export default razorpayWebhookHandler;
