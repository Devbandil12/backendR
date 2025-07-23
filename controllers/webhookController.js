// controllers/webhookController.js

import crypto from 'crypto';
import { db } from '../configs/index.js';
import { ordersTable } from '../configs/schema.js';
import { eq } from 'drizzle-orm';

const razorpayWebhookHandler = async (req, res) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const signature = req.headers['x-razorpay-signature'];

  // 1. Verify signature using raw body
  const expected = crypto
    .createHmac('sha256', secret)
    .update(req.body)
    .digest('hex');

  if (signature !== expected) {
    console.warn("⚠️ Invalid Razorpay webhook signature");
    return res.status(400).send("Invalid signature");
  }

  let parsed;
  try {
    parsed = JSON.parse(req.body.toString('utf8'));
  } catch (err) {
    console.error("❌ Failed to parse Razorpay webhook body:", err);
    return res.status(400).send("Invalid JSON");
  }

  const { event, payload } = parsed;
  if (!event.startsWith("refund.")) {
    return res.status(200).send("Ignored non-refund event");
  }

  const refund = payload.refund.entity;

  const updateFields = {
    refund_status: refund.status,
    refund_completed_at:
      refund.status === 'processed' && refund.processed_at
        ? new Date(refund.processed_at * 1000).toISOString()
        : null,
    refund_speed: refund.speed_processed || null,
    paymentStatus: refund.status === 'processed' ? 'refunded' : undefined,
  };

  try {
    const result = await db
      .update(ordersTable)
      .set(updateFields)
      .where(eq(ordersTable.refund_id, refund.id));

    if (result.rowCount > 0) {
      console.log(`✅ Webhook updated refund ${refund.id} → ${refund.status}`);
    } else {
      console.warn(`⚠️ Webhook: No order found for refund_id ${refund.id}`);
    }

    return res.status(200).send("OK");
  } catch (err) {
    console.error("❌ DB error in webhook:", err);
    return res.status(500).send("Database update failed");
  }
};

export default razorpayWebhookHandler;
