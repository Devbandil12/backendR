// ✅ file: routes/paymentRoute.js
import express from 'express';
import multer from 'multer';
import pdf from 'pdf-parse';
import { createOrder, verifyPayment } from './payments.controller.js';
import { refundOrder } from './refunds/refunds.controller.js';
import { getPriceBreakdown } from '../checkout/price.controller.js';

// 🔒 SECURITY
import { requireAuth } from "../../middleware/auth.js";
import { rateLimit } from "../../middleware/rate-limit.js"; // 🟢 FIX: stricter limits for money-moving routes

const router = express.Router();

router.use(express.json());
router.use(express.urlencoded({ extended: false }));

/* ======================================================
   🔒 SECURED ROUTES
   - All these controllers now look for `req.auth.userId`
   - They do NOT trust `req.body.userId` anymore
====================================================== */

// 🟢 FIX: createOrder and verify-payment each hit Razorpay and touch stock/
// coupon limits — cap them per-user well below anything a real checkout
// flow would need, to blunt scripted abuse.
const paymentLimiter = rateLimit({
  windowSeconds: 60,
  max: 15,
  keyPrefix: 'rl:payments',
  message: 'Too many payment requests. Please wait a moment and try again.',
  byUser: true,
});

// 🟢 FIX: /breakdown fires on nearly every cart/address keystroke during
// checkout — generous limit, just enough to blunt a scripted hammering of
// this endpoint (it's unauthenticated).
const breakdownLimiter = rateLimit({
  windowSeconds: 60,
  max: 120,
  keyPrefix: 'rl:price-breakdown',
  message: 'Too many requests. Please slow down.',
});

// 1. Price Breakdown (Authenticated)
router.post('/breakdown', breakdownLimiter, getPriceBreakdown);

// 2. Create Order (Authenticated - Complex Logic)
router.post('/createOrder', requireAuth, paymentLimiter, createOrder);

// 3. Verify Payment (Authenticated)
router.post('/verify-payment', requireAuth, paymentLimiter, verifyPayment);

// 4. Refund (Authenticated - Admin/Owner Only)
router.post('/refund', requireAuth, paymentLimiter, refundOrder);

// 5. PDF Upload (Authenticated)
const upload = multer({ storage: multer.memoryStorage() });
router.post('/getdata', requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const result = await pdf(req.file.buffer);
    res.json({ text: result.text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
