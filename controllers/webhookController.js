import crypto from 'crypto';
import { db } from '../configs/index.js';
import { ordersTable } from '../configs/schema.js';
import { eq } from 'drizzle-orm';

const razorpayWebhookHandler = async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const body = req.body; // ⚠️ raw buffer from express.raw()

  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');

  if (signature !== expected) {
    console.warn('⚠️ Invalid webhook signature');
    return res.status(400).send('Invalid signature');
  }

  // ✅ Signature matched → parse JSON body
  const { event, payload: { refund: { entity } } } = JSON.parse(body);

  if (!event.startsWith('refund.')) {
    return res.status(200).send('Ignored');
  }

  const updates = {
    refund_status: entity.status,
    refund_completed_at: entity.status === 'processed'
      ? new Date(entity.processed_at * 1000)
      : null,
    updatedAt: new Date().toISOString(),
  };

  if (entity.status === 'processed') {
    updates.paymentStatus = 'refunded';
    updates.status = 'Order Cancelled';
  } else if (entity.status === 'failed') {
    console.warn(`⚠️ Refund failed for order with refund_id: ${entity.id}`);
  }

  try {
    await db
      .update(ordersTable)
      .set(updates)
      .where(eq(ordersTable.refund_id, entity.id));

    return res.status(200).send("Webhook processed");
  } catch (err) {
    console.error('Webhook processing error:', err);
    return res.status(500).send('DB error');
  }
};


export default razorpayWebhookHandler;