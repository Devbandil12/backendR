// routes/checkoutOtp.js
//
// Two endpoints backing the COD WhatsApp-OTP feature:
//
//   POST /api/checkout-otp/send    - evaluate risk, and only if the risk
//                                    engine says it's actually required AND
//                                    COD_OTP_MODE=enforce, generate + send
//                                    an OTP. In shadow mode this ALWAYS
//                                    responds { required: false } and never
//                                    dispatches a real message — shadow mode
//                                    should cost nothing and block no one.
//   POST /api/checkout-otp/verify  - check the code, mint a short-lived
//                                    single-use verificationToken, and
//                                    remember the phone as verified for
//                                    COD_OTP_TRUST_DAYS.
//
// createOrder (controllers/paymentController.js) is still the real gate —
// it re-evaluates risk itself and requires a valid, unconsumed token when
// enforcement is on. These two routes exist to drive the checkout UI, not
// to be the sole line of defense.

import express from 'express';
import crypto from 'crypto';
import { db } from '../configs/index.js';
import { usersTable, UserAddressTable, otpVerificationsTable, verifiedPhonesTable } from '../configs/schema.js';
import { eq, and, gt } from 'drizzle-orm';
import { requireAuth } from '../middleware/authMiddleware.js';
import { rateLimit } from '../middleware/rateLimiter.js';
import { evaluateCodRisk, logOtpDecision } from '../helpers/codRiskEngine.js';
import { generateOtp, hashOtp, dispatchOtp, maskPhone } from '../services/whatsappOtp.service.js';
import { safeCompare } from '../helpers/safeCompare.js';
import { logger } from '../services/logger.js';

const router = express.Router();
router.use(express.json());

const OTP_MODE = (process.env.COD_OTP_MODE || 'shadow').toLowerCase(); // 'shadow' | 'enforce'
const OTP_TTL_SECONDS = Number(process.env.COD_OTP_TTL_SECONDS || 300); // 5 min
const OTP_MAX_ATTEMPTS = Number(process.env.COD_OTP_MAX_ATTEMPTS || 5);
const TOKEN_TTL_MINUTES = Number(process.env.COD_OTP_TOKEN_TTL_MINUTES || 20); // enough to finish checkout

// Sending an OTP costs real money — keep this tight. Keyed by user, not IP,
// since it sits behind requireAuth.
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

async function resolveUser(req, res) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, req.auth.userId));
  if (!user) {
    res.status(401).json({ success: false, msg: 'Authentication failed. Please log in.' });
    return null;
  }
  return user;
}

// 1. SEND (evaluate risk, dispatch only if genuinely required + enforcing)
router.post('/send', requireAuth, sendLimiter, async (req, res) => {
  try {
    const user = await resolveUser(req, res);
    if (!user) return;

    const { userAddressId, cartTotal } = req.body;
    if (!userAddressId || cartTotal === undefined) {
      return res.status(400).json({ success: false, msg: 'userAddressId and cartTotal are required.' });
    }

    const [address] = await db.select().from(UserAddressTable).where(eq(UserAddressTable.id, userAddressId));
    if (!address || address.userId !== user.id) {
      return res.status(404).json({ success: false, msg: 'Address not found.' });
    }

    const { required, reasons, trustedPhone } = await evaluateCodRisk({
      userId: user.id,
      phone: address.phone,
      address,
      cartTotal,
    });

    // Always log the decision — this is the data you review before ever
    // flipping COD_OTP_MODE to 'enforce'.
    logOtpDecision({
      userId: user.id,
      phone: address.phone,
      postalCode: address.postalCode,
      cartTotal,
      mode: OTP_MODE,
      required,
      reasons,
    });

    if (!required || trustedPhone || OTP_MODE !== 'enforce') {
      // Shadow mode (or a not-actually-risky order) never sends a real
      // message and never blocks the customer.
      return res.json({ success: true, required: false });
    }

    const otp = generateOtp(6);
    const otpHash = hashOtp(otp);
    const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000);

    const [record] = await db.insert(otpVerificationsTable).values({
      userId: user.id,
      phone: address.phone,
      otpHash,
      purpose: 'cod_checkout',
      maxAttempts: OTP_MAX_ATTEMPTS,
      expiresAt,
    }).returning();

    let channel = 'whatsapp';
    try {
      const dispatchResult = await dispatchOtp(address.phone, otp);
      channel = dispatchResult.channel;
      if (channel !== 'whatsapp') {
        await db.update(otpVerificationsTable).set({ channel }).where(eq(otpVerificationsTable.id, record.id));
      }
    } catch (err) {
      logger.error('[checkoutOtp] Dispatch failed entirely', { err: err.message, userId: user.id });
      return res.status(502).json({
        success: false,
        msg: "We couldn't send a verification code right now. Please try again in a moment, or choose online payment instead.",
      });
    }

    return res.json({
      success: true,
      required: true,
      otpRequestId: record.id,
      maskedPhone: maskPhone(address.phone),
      channel,
      expiresInSeconds: OTP_TTL_SECONDS,
      reasons, // safe to expose — helps the UI phrase the "why" note; drop if you'd rather not
    });
  } catch (err) {
    logger.error('[checkoutOtp] /send error', { err: err.message });
    return res.status(500).json({ success: false, msg: 'Something went wrong. Please try again.' });
  }
});

// 2. VERIFY (check code, mint a short-lived token, remember the phone)
router.post('/verify', requireAuth, verifyLimiter, async (req, res) => {
  try {
    const user = await resolveUser(req, res);
    if (!user) return;

    const { otpRequestId, code } = req.body;
    if (!otpRequestId || !code) {
      return res.status(400).json({ success: false, msg: 'otpRequestId and code are required.' });
    }

    const [record] = await db.select().from(otpVerificationsTable).where(eq(otpVerificationsTable.id, otpRequestId));

    if (!record || record.userId !== user.id) {
      return res.status(404).json({ success: false, msg: 'Verification request not found.' });
    }
    if (record.verified) {
      return res.status(400).json({ success: false, msg: 'This code has already been used.' });
    }
    if (new Date(record.expiresAt) < new Date()) {
      return res.status(400).json({ success: false, code: 'OTP_EXPIRED', msg: 'This code has expired. Please request a new one.' });
    }
    if (record.attempts >= record.maxAttempts) {
      return res.status(429).json({ success: false, code: 'OTP_LOCKED', msg: 'Too many incorrect attempts. Please request a new code.' });
    }

    const candidateHash = hashOtp(String(code).trim());
    const isMatch = safeCompare(candidateHash, record.otpHash);

    if (!isMatch) {
      await db.update(otpVerificationsTable)
        .set({ attempts: record.attempts + 1 })
        .where(eq(otpVerificationsTable.id, record.id));
      const remaining = record.maxAttempts - (record.attempts + 1);
      return res.status(400).json({
        success: false,
        code: 'OTP_INCORRECT',
        msg: remaining > 0 ? `Incorrect code. ${remaining} attempt(s) left.` : 'Incorrect code.',
      });
    }

    const verificationToken = crypto.randomBytes(24).toString('hex');
    const tokenExpiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000);

    await db.update(otpVerificationsTable).set({
      verified: true,
      verifiedAt: new Date(),
      verificationToken,
      expiresAt: tokenExpiresAt, // repurpose expiry to gate the token's own lifetime now
    }).where(eq(otpVerificationsTable.id, record.id));

    // Remember this phone so future COD checkouts skip verification entirely.
    await db.insert(verifiedPhonesTable)
      .values({ userId: user.id, phone: record.phone })
      .onConflictDoUpdate({
        target: [verifiedPhonesTable.userId, verifiedPhonesTable.phone],
        set: { verifiedAt: new Date() },
      });

    return res.json({ success: true, verificationToken });
  } catch (err) {
    logger.error('[checkoutOtp] /verify error', { err: err.message });
    return res.status(500).json({ success: false, msg: 'Something went wrong. Please try again.' });
  }
});

export default router;
