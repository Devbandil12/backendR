// routes/phoneVerification.js
//
// Part A2/A3 — user-initiated phone verification, used by the Profile page
// and by the address form's "add a new number" path. Unlike
// routes/checkoutOtp.js (which is gated by the COD risk engine and only
// fires for orders that are actually flagged), this always sends when
// called — the user explicitly asked to verify a number, so there's no
// "should we bother" decision to make here.
//
// On success, the phone is written to verified_phones (shared with the
// COD OTP system — a number verified here is trusted everywhere, per the
// "verify once, anywhere" model), and if the user has no default phone
// yet, this becomes it.

import express from 'express';
import crypto from 'crypto';
import { db } from '../configs/index.js';
import { usersTable, otpVerificationsTable, verifiedPhonesTable } from '../configs/schema.js';
import { eq, and } from 'drizzle-orm';
import { requireAuth } from '../middleware/authMiddleware.js';
import { rateLimit } from '../middleware/rateLimiter.js';
import { generateOtp, hashOtp, dispatchOtp, maskPhone } from '../services/whatsappOtp.service.js';
import { safeCompare } from '../helpers/safeCompare.js';
import { logger } from '../services/logger.js';

const router = express.Router();
router.use(express.json());

const OTP_TTL_SECONDS = Number(process.env.COD_OTP_TTL_SECONDS || 300);
const OTP_MAX_ATTEMPTS = Number(process.env.COD_OTP_MAX_ATTEMPTS || 5);
const TOKEN_TTL_MINUTES = Number(process.env.COD_OTP_TOKEN_TTL_MINUTES || 20);
const PHONE_REGEX = /^[6-9]\d{9}$/;

const sendLimiter = rateLimit({ windowSeconds: 300, max: 4, keyPrefix: 'rl:phone-verify-send', message: 'Too many requests. Please wait a few minutes.', byUser: true });
const verifyLimiter = rateLimit({ windowSeconds: 300, max: 15, keyPrefix: 'rl:phone-verify-verify', message: 'Too many attempts. Please wait a few minutes.', byUser: true });

async function resolveUser(req, res) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, req.auth.userId));
  if (!user) {
    res.status(401).json({ success: false, msg: 'Authentication failed. Please log in.' });
    return null;
  }
  return user;
}

router.post('/send', requireAuth, sendLimiter, async (req, res) => {
  try {
    const user = await resolveUser(req, res);
    if (!user) return;

    const { phone } = req.body;
    if (!phone || !PHONE_REGEX.test(String(phone).trim())) {
      return res.status(400).json({ success: false, msg: 'A valid 10-digit mobile number is required.' });
    }
    const cleanPhone = String(phone).trim();

    // Already verified for this user — nothing to do.
    const [existing] = await db.select({ id: verifiedPhonesTable.id }).from(verifiedPhonesTable)
      .where(and(eq(verifiedPhonesTable.userId, user.id), eq(verifiedPhonesTable.phone, cleanPhone))).limit(1);
    if (existing) {
      return res.json({ success: true, alreadyVerified: true });
    }

    const otp = generateOtp(6);
    const otpHash = hashOtp(otp);
    const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000);

    const [record] = await db.insert(otpVerificationsTable).values({
      userId: user.id, phone: cleanPhone, otpHash,
      purpose: 'general_verification', maxAttempts: OTP_MAX_ATTEMPTS, expiresAt,
    }).returning();

    let channel = 'whatsapp';
    try {
      const dispatchResult = await dispatchOtp(cleanPhone, otp);
      channel = dispatchResult.channel;
      if (channel !== 'whatsapp') {
        await db.update(otpVerificationsTable).set({ channel }).where(eq(otpVerificationsTable.id, record.id));
      }
    } catch (err) {
      logger.error('[phoneVerification] Dispatch failed', { err: err.message, userId: user.id });
      return res.status(502).json({ success: false, msg: "We couldn't send a verification code right now. Please try again shortly." });
    }

    return res.json({
      success: true, alreadyVerified: false, otpRequestId: record.id,
      maskedPhone: maskPhone(cleanPhone), channel, expiresInSeconds: OTP_TTL_SECONDS,
    });
  } catch (err) {
    logger.error('[phoneVerification] /send error', { err: err.message });
    return res.status(500).json({ success: false, msg: 'Something went wrong. Please try again.' });
  }
});

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

    const isMatch = safeCompare(hashOtp(String(code).trim()), record.otpHash);
    if (!isMatch) {
      await db.update(otpVerificationsTable).set({ attempts: record.attempts + 1 }).where(eq(otpVerificationsTable.id, record.id));
      const remaining = record.maxAttempts - (record.attempts + 1);
      return res.status(400).json({ success: false, code: 'OTP_INCORRECT', msg: remaining > 0 ? `Incorrect code. ${remaining} attempt(s) left.` : 'Incorrect code.' });
    }

    const verificationToken = crypto.randomBytes(24).toString('hex');
    await db.update(otpVerificationsTable).set({
      verified: true, verifiedAt: new Date(), verificationToken,
      expiresAt: new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000),
    }).where(eq(otpVerificationsTable.id, record.id));

    await db.insert(verifiedPhonesTable).values({ userId: user.id, phone: record.phone })
      .onConflictDoUpdate({ target: [verifiedPhonesTable.userId, verifiedPhonesTable.phone], set: { verifiedAt: new Date() } });

    // 🟢 NEW: Part A2 — if the user has no default phone yet, this becomes it.
    if (!user.phone) {
      await db.update(usersTable).set({
        phone: record.phone, phoneVerified: true, phoneVerifiedAt: new Date(),
      }).where(eq(usersTable.id, user.id));
    } else if (user.phone === record.phone) {
      await db.update(usersTable).set({ phoneVerified: true, phoneVerifiedAt: new Date() }).where(eq(usersTable.id, user.id));
    }

    return res.json({ success: true, verificationToken });
  } catch (err) {
    logger.error('[phoneVerification] /verify error', { err: err.message });
    return res.status(500).json({ success: false, msg: 'Something went wrong. Please try again.' });
  }
});

// List this user's verified phones — powers the address-form quick-picker (Part A3)
router.get('/list', requireAuth, async (req, res) => {
  try {
    const user = await resolveUser(req, res);
    if (!user) return;
    const phones = await db.select().from(verifiedPhonesTable).where(eq(verifiedPhonesTable.userId, user.id));
    return res.json({ success: true, phones, defaultPhone: user.phone });
  } catch (err) {
    logger.error('[phoneVerification] /list error', { err: err.message });
    return res.status(500).json({ success: false, msg: 'Something went wrong.' });
  }
});

export default router;
