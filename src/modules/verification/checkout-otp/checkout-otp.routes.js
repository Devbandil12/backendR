import express from 'express';
import { requireAuth } from '../../../middleware/auth.js';
import { rateLimit } from '../../../middleware/rate-limit.js';
import * as CheckoutOtpController from './checkout-otp.controller.js';

const router = express.Router();
router.use(express.json());

const sendLimiter = rateLimit({
  windowSeconds: 300,
  max: 4,
  keyPrefix: 'rl:checkout-otp-send',
  message: 'Too many OTP requests. Please wait a few minutes and try again.',
  byUser: true,
});

const verifyLimiter = rateLimit({
  windowSeconds: 300,
  max: 15,
  keyPrefix: 'rl:checkout-otp-verify',
  message: 'Too many attempts. Please wait a few minutes and try again.',
  byUser: true,
});

router.post('/send', requireAuth, sendLimiter, CheckoutOtpController.sendOtp);
router.post('/verify', requireAuth, verifyLimiter, CheckoutOtpController.verifyOtp);

export default router;
