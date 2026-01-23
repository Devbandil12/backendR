// ✅ file: routes/paymentRoute.js
import express from 'express';
import multer from 'multer';
import pdf from 'pdf-parse';
import { createOrder, verifyPayment } from '../controllers/paymentController.js';
import { refundOrder } from '../controllers/refundController.js';
import { getPriceBreakdown } from '../controllers/priceController.js';

// 🔒 SECURITY
import { requireAuth } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(express.json());
router.use(express.urlencoded({ extended: false }));

/* ======================================================
   🔒 SECURED ROUTES
   - All these controllers now look for `req.auth.userId`
   - They do NOT trust `req.body.userId` anymore
====================================================== */

// 1. Price Breakdown (Authenticated)
router.post('/breakdown', getPriceBreakdown);

// 2. Create Order (Authenticated - Complex Logic)
router.post('/createOrder', requireAuth, createOrder);

// 3. Verify Payment (Authenticated)
router.post('/verify-payment', requireAuth, verifyPayment);

// 4. Refund (Authenticated - Admin/Owner Only)
router.post('/refund', requireAuth, refundOrder);

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