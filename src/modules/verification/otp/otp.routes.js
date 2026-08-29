import express from 'express';
import { ClerkExpressRequireAuth } from '@clerk/clerk-sdk-node';
import * as OtpController from './otp.controller.js';
import { rateLimit } from '../../../middleware/rate-limit.js';

const router = express.Router();

const reqRateLimit = rateLimit({ windowSeconds: 60, max: 10, keyPrefix: 'rl:otp:req', byUser: true });
const verRateLimit = rateLimit({ windowSeconds: 60, max: 20, keyPrefix: 'rl:otp:ver', byUser: true });

router.post('/request', ClerkExpressRequireAuth(), reqRateLimit, OtpController.requestOtp);
router.post('/verify', ClerkExpressRequireAuth(), verRateLimit, OtpController.verifyOtp);
router.get('/list', ClerkExpressRequireAuth(), OtpController.listVerifiedPhones);

export default router;
