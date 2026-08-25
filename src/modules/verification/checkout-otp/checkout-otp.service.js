import crypto from 'crypto';
import * as CheckoutOtpRepository from './checkout-otp.repository.js';
import { evaluateCodRisk, logOtpDecision } from '../../../modules/risk/cod-risk.service.js';
import { generateOtp, hashOtp, dispatchOtp, maskPhone } from '../../../infrastructure/messaging/whatsapp/index.js';
import { safeCompare } from '../../../utils/safeCompare.js';
import { logger } from '../../../observability/logger.js';

const OTP_MODE = (process.env.COD_OTP_MODE || 'shadow').toLowerCase();
const OTP_TTL_SECONDS = Number(process.env.COD_OTP_TTL_SECONDS || 300);
const OTP_MAX_ATTEMPTS = Number(process.env.COD_OTP_MAX_ATTEMPTS || 5);
const TOKEN_TTL_MINUTES = Number(process.env.COD_OTP_TOKEN_TTL_MINUTES || 20);

export const sendOtp = async (user, userAddressId, cartTotal) => {
  const address = await CheckoutOtpRepository.getAddressById(userAddressId);
  if (!address || address.userId !== user.id) {
    throw { status: 404, msg: 'Address not found.' };
  }

  const { required, reasons, trustedPhone } = await evaluateCodRisk({
    userId: user.id,
    phone: address.phone,
    address,
    cartTotal,
  });

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
    return { required: false };
  }

  const otp = generateOtp(6);
  const otpHash = hashOtp(otp);
  const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000);

  const record = await CheckoutOtpRepository.insertOtpVerification({
    userId: user.id,
    phone: address.phone,
    otpHash,
    purpose: 'cod_checkout',
    maxAttempts: OTP_MAX_ATTEMPTS,
    expiresAt,
  });

  let channel = 'whatsapp';
  try {
    const dispatchResult = await dispatchOtp(address.phone, otp);
    channel = dispatchResult.channel;
    if (channel !== 'whatsapp') {
      await CheckoutOtpRepository.updateOtpVerificationChannel(record.id, channel);
    }
  } catch (err) {
    logger.error('[checkoutOtp] Dispatch failed entirely', { err: err.message, userId: user.id });
    throw {
        status: 502,
        msg: "We couldn't send a verification code right now. Please try again in a moment, or choose online payment instead."
    };
  }

  return {
    required: true,
    otpRequestId: record.id,
    maskedPhone: maskPhone(address.phone),
    channel,
    expiresInSeconds: OTP_TTL_SECONDS,
    reasons,
  };
};

export const verifyOtp = async (user, otpRequestId, code) => {
  const record = await CheckoutOtpRepository.getOtpVerificationById(otpRequestId);

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

  const candidateHash = hashOtp(String(code).trim());
  const isMatch = safeCompare(candidateHash, record.otpHash);

  if (!isMatch) {
    await CheckoutOtpRepository.incrementOtpAttempts(record.id, record.attempts);
    const remaining = record.maxAttempts - (record.attempts + 1);
    throw {
      status: 400,
      code: 'OTP_INCORRECT',
      msg: remaining > 0 ? `Incorrect code. ${remaining} attempt(s) left.` : 'Incorrect code.',
    };
  }

  const verificationToken = crypto.randomBytes(24).toString('hex');
  const tokenExpiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000);

  await CheckoutOtpRepository.markOtpVerified(record.id, verificationToken, tokenExpiresAt);
  await CheckoutOtpRepository.upsertVerifiedPhone(user.id, record.phone);

  return { verificationToken };
};
