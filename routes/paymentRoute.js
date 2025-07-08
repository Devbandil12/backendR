import express from 'express';
import crypto from 'crypto';
import multer from 'multer';
import pdf from 'pdf-parse';
import Razorpay from 'razorpay';
import { db } from '../configs/index.js';
import { ordersTable } from '../configs/schema.js';
import { eq } from 'drizzle-orm';
import * as paymentController from '../controllers/paymentController.js';

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
router.post('/breakdown', paymentController.getPriceBreakdown);
router.post('/createOrder', paymentController.createOrder);
router.post('/verify-payment', paymentController.verify);

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

// ─── 3️⃣ ON-DEMAND REFUND ─────────────────────────────────
router.post('/refund', async (req, res) => {
  const { orderId, amount, speed = 'optimum', notes } = req.body;

  const [order] = await db
    .select({ paymentId: ordersTable.transactionId })
    .from(ordersTable)
    .where(eq(ordersTable.id, orderId));

  if (!order?.paymentId) {
    return res.status(404).json({ success: false, msg: 'Order/payment not found' });
  }

  try {
    const refund = await razorpay.payments.refund(order.paymentId, {
      amount,
      speed,
      notes: notes || { reason: 'User requested refund' },
    });

    await db
      .update(ordersTable)
      .set({
        refund_id: refund.id,
        status: 'Order Cancelled',
        refund_amount: refund.amount,
        refund_status: refund.status,
        refund_speed: refund.speed,
        refund_initiated_at: new Date(refund.created_at * 1000),
        status: refund.status === 'processed' ? 'Order Cancelled' : ordersTable.status,
        refund_completed_at: refund.status === 'processed'
          ? new Date(refund.processed_at * 1000)
          : null,
        paymentStatus: refund.status === 'processed' ? 'refunded' : 'paid',

      })
      .where(eq(ordersTable.id, orderId));

    res.json({ success: true, refund });
  } catch (err) {
    console.error('Refund initiation error:', err);
    res.status(500).json({ success: false, msg: 'Refund failed' });
  }
});

// ─── 4️⃣ RAZORPAY WEBHOOK ─────────────────────────────────
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
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
    refund_completed_at: entity.status === 'processed' ? new Date(entity.processed_at * 1000) : null,
    ...(entity.status === 'processed' && {
      paymentStatus: 'refunded',
      status: 'Order Cancelled',
    }),
  };


  try {
    await db
      .update(ordersTable)
      .set(updates)
      .where(eq(ordersTable.refundId, entity.id));

    res.status(200).send('OK');
  } catch (err) {
    console.error('Webhook processing error:', err);
    res.status(500).send('DB error');
  }
});

router.all('*', (req, res) => {
  console.log(`❗ Unmatched route hit: ${req.method} ${req.originalUrl}`);
  res.status(405).json({ error: 'Method not allowed at this endpoint' });
});


export default router;


