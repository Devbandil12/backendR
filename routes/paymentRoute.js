// file routes/paymentRoute.js

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

