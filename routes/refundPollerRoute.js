// routes/refundPollerRoute.js
import express from 'express';
import { pollRefunds } from '../refundPoller.js';

const router = express.Router();

router.get('/poll-refunds', async (req, res) => {
  try {
    await pollRefunds();
    res.send('✅ Refund polling completed.');
  } catch (err) {
    console.error('❌ Refund polling failed:', err);
    res.status(500).send('Refund polling failed.');
  }
});

export default router;
