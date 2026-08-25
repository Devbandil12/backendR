import crypto from 'crypto';
import * as PhoneRepository from './phone.repository.js';
import { generateOtp, hashOtp, dispatchOtp, maskPhone } from '../../../infrastructure/messaging/whatsapp/index.js';
import { safeCompare } from '../../../utils/safeCompare.js';
import { logger } from '../../../observability/logger.js';

const OTP_TTL_SECONDS = Number(process.env.COD_OTP_TTL_SECONDS || 300);
const OTP_MAX_ATTEMPTS = Number(process.env.COD_OTP_MAX_ATTEMPTS || 5);
const TOKEN_TTL_MINUTES = Number(process.env.COD_OTP_TOKEN_TTL_MINUTES || 20);

export const sendOtp = async (user, cleanPhone) => {
  const existing = await PhoneRepository.checkVerifiedPhone(user.id, cleanPhone);
  if (existing) {
    return { alreadyVerified: true };
  }

  const otp = generateOtp(6);
  const otpHash = hashOtp(otp);
  const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000);

  const record = await PhoneRepository.insertOtpVerification({
    userId: user.id, phone: cleanPhone, otpHash,
    purpose: 'general_verification', maxAttempts: OTP_MAX_ATTEMPTS, expiresAt,
  });

  let channel = 'whatsapp';
  try {
    const dispatchResult = await dispatchOtp(cleanPhone, otp);
    channel = dispatchResult.channel;
    if (channel !== 'whatsapp') {
      await PhoneRepository.updateOtpVerificationChannel(record.id, channel);
    }
  } catch (err) {
    logger.error('[phoneVerification] Dispatch failed', { err: err.message, userId: user.id });
    throw { status: 502, msg: "We couldn't send a verification code right now. Please try again shortly." };
  }

  return {
    alreadyVerified: false, otpRequestId: record.id,
    maskedPhone: maskPhone(cleanPhone), channel, expiresInSeconds: OTP_TTL_SECONDS,
  };
};

export const verifyOtp = async (user, otpRequestId, code) => {
  const record = await PhoneRepository.getOtpVerificationById(otpRequestId);
  if (!record || record.userId !== user.id) {
    throw { status: 404, msg: 'Verification request not found.' };
  }
  if (record.verified) {
    throw { status: 400, msg: 'This code has already been used.' };
  }
  if (new Date(record.expiresAt) < new Date()) {
    throw { status: 400, code: 'OTP_EXPIRED', msg: 'This code has expired. Please request a new one.' };
  }
  if (record.attempts >= record.maxAttempts) {
    throw { status: 429, code: 'OTP_LOCKED', msg: 'Too many incorrect attempts. Please request a new code.' };
  }

  const isMatch = safeCompare(hashOtp(String(code).trim()), record.otpHash);
  if (!isMatch) {
    await PhoneRepository.incrementOtpAttempts(record.id, record.attempts);
    const remaining = record.maxAttempts - (record.attempts + 1);
    throw { status: 400, code: 'OTP_INCORRECT', msg: remaining > 0 ? `Incorrect code. ${remaining} attempt(s) left.` : 'Incorrect code.' };
  }

  const verificationToken = crypto.randomBytes(24).toString('hex');
  await PhoneRepository.markOtpVerified(record.id, verificationToken, new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000));
  await PhoneRepository.upsertVerifiedPhone(user.id, record.phone);

  if (!user.phone) {
    await PhoneRepository.updateUserDefaultPhone(user.id, record.phone, false);
  } else if (user.phone === record.phone) {
    await PhoneRepository.updateUserDefaultPhone(user.id, record.phone, true);
  }

  return { verificationToken };
};

export const listVerifiedPhones = async (userId) => {
  return await PhoneRepository.listVerifiedPhones(userId);
};
