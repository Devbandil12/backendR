import express from 'express';
import crypto from 'crypto';
import multer from 'multer';
import pdf from 'pdf-parse';
import Razorpay from 'razorpay';
import { db } from '../configs/index.js';
import { ordersTable } from '../configs/schema.js';
import { eq } from 'drizzle-orm';

import { createOrder, verifyPayment } from '../controllers/paymentController.js';
import { refundOrder }               from '../controllers/refundController.js';
import { getPriceBreakdown }         from '../controllers/priceController.js';



export const razorpayWebhookHandler = async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const body = req.body.toString();

  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');

  if (signature !== expected) {
    console.warn('⚠️ Invalid webhook signature');
    return res.status(400).send('Invalid signature');
  }

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
    res.status(500).send('DB error');
  }
};



const router = express.Router();

// ─── Razorpay client ───────────────────────────────────────
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_ID_KEY,
  key_secret: process.env.RAZORPAY_SECRET_KEY,
});



// ─── Middleware ────────────────────────────────────────────
router.use(express.json());
router.use(express.urlencoded({ extended: false }));



// ─── 1️⃣ CREATE ORDER & VERIFY PAYMENT ─────────────────────
// 👉 New price‐breakdown endpoint
router.post('/breakdown',     getPriceBreakdown);
router.post('/createOrder',   createOrder);
router.post('/verify-payment', verifyPayment);
router.post('/refund',        refundOrder);


// ─── 2️⃣ PDF UPLOAD & PARSE ────────────────────────────────
const upload = multer({ storage: multer.memoryStorage() });

router.post('/getdata', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    const result = await pdf(req.file.buffer);
    res.json({ text: result.text });
  } catch (err) {
    console.error('PDF parse error:', err);
    res.status(500).json({ error: err.message });
  }
});



export default router;


