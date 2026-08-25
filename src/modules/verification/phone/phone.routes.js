import express from 'express';
import { requireAuth } from '../../../middleware/auth.js';
import { rateLimit } from '../../../middleware/rate-limit.js';
import * as PhoneController from './phone.controller.js';

const router = express.Router();
router.use(express.json());

const sendLimiter = rateLimit({ windowSeconds: 300, max: 4, keyPrefix: 'rl:phone-verify-send', message: 'Too many requests. Please wait a few minutes.', byUser: true });
const verifyLimiter = rateLimit({ windowSeconds: 300, max: 15, keyPrefix: 'rl:phone-verify-verify', message: 'Too many attempts. Please wait a few minutes.', byUser: true });

router.post('/send', requireAuth, sendLimiter, PhoneController.sendOtp);
router.post('/verify', requireAuth, verifyLimiter, PhoneController.verifyOtp);
router.get('/list', requireAuth, PhoneController.listVerifiedPhones);

export default router;
