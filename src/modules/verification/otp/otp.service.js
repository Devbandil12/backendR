import crypto from 'crypto';
import { logger } from '../../../observability/logger.js';
import * as OtpRepository from './otp.repository.js';
import { db } from '../../../db/client.js';

const AUTH_KEY = process.env.MSG91_AUTH_KEY;
const WA_INTEGRATED_NUMBER = process.env.MSG91_WHATSAPP_INTEGRATED_NUMBER;
const WA_TEMPLATE_NAME = process.env.MSG91_WHATSAPP_TEMPLATE_NAME || 'otp_verification';
const WA_NAMESPACE = null;
const SMS_TEMPLATE_ID = process.env.MSG91_SMS_TEMPLATE_ID;
const SMS_SENDER_ID = process.env.MSG91_SMS_SENDER_ID;
const PEPPER = process.env.COD_OTP_PEPPER;

const WA_SEND_URL = 'https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/';
const SMS_SEND_URL = 'https://control.msg91.com/api/v5/flow/';

if (!PEPPER) {
  throw new Error('COD_OTP_PEPPER is missing in environment variables. Refusing to start.');
}

function generateOtp(length = 6) {
  const digits = '0123456789';
  let otp = '';
  for (let i = 0; i < length; i++) {
    otp += digits[crypto.randomInt(0, digits.length)];
  }
  return otp;
}

function hashOtp(otp) {
  return crypto.createHash('sha256').update(`${otp}:${PEPPER}`).digest('hex');
}

function toE164India(phone) {
  const digitsOnly = String(phone).replace(/\D/g, '');
  if (digitsOnly.length === 10) return `91${digitsOnly}`;
  if (digitsOnly.length === 12 && digitsOnly.startsWith('91')) return digitsOnly;
  return null;
}

async function sendWhatsappOtp(phone, otp) {
  const to = toE164India(phone);
  if (!to) throw new Error('INVALID_PHONE');

  const res = await fetch(WA_SEND_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', authkey: AUTH_KEY },
    body: JSON.stringify({
      integrated_number: WA_INTEGRATED_NUMBER,
      content_type: 'template',
      payload: {
        messaging_product: 'whatsapp',
        type: 'template',
        template: {
          name: WA_TEMPLATE_NAME,
          language: { code: 'en', policy: 'deterministic' },
          to_and_components: [
            {
              to: [to],
              components: {
                body_1: { type: 'text', value: otp },
                button_1: { subtype: 'url', type: 'text', value: otp }
              },
            },
          ],
        },
      },
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.status === 'error' || data?.type === 'error' || data?.hasError === true) {
    throw new Error(data?.errors || data?.message || `MSG91 WhatsApp send failed (${res.status})`);
  }
  return data;
}

async function sendSmsOtp(phone, otp) {
  const to = toE164India(phone);
  if (!to) throw new Error('INVALID_PHONE');
  if (!SMS_TEMPLATE_ID) throw new Error('SMS_FALLBACK_NOT_CONFIGURED');

  const res = await fetch(SMS_SEND_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', authkey: AUTH_KEY },
    body: JSON.stringify({
      template_id: SMS_TEMPLATE_ID,
      sender: SMS_SENDER_ID,
      short_url: '0',
      mobiles: to,
      OTP: otp,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.type === 'error') {
    throw new Error(data?.message || `MSG91 SMS send failed (${res.status})`);
  }
  return data;
}

async function dispatchOtp(phone, otp) {
  try {
    await sendWhatsappOtp(phone, otp);
    return { channel: 'whatsapp' };
  } catch (err) {
    logger.warn('[whatsappOtp] WhatsApp send failed, falling back to SMS', { err: err.message });
    try {
      await sendSmsOtp(phone, otp);
      return { channel: 'sms' };
    } catch (smsErr) {
      logger.error('[whatsappOtp] SMS fallback also failed', { err: smsErr.message });
      throw new Error('OTP_DISPATCH_FAILED');
    }
  }
}

export async function requestOtp(userId, rawPhone, purpose) {
  const validPurposes = ['PHONE_SETTINGS', 'ADDRESS', 'CHECKOUT'];
  if (!validPurposes.includes(purpose)) {
    throw new Error('INVALID_PURPOSE');
  }

  const phone = toE164India(rawPhone);
  if (!phone) {
    throw { code: 'INVALID_PHONE', msg: 'Invalid phone number format.' };
  }

  const isVerified = await OtpRepository.getVerifiedPhone(userId, phone);
  if (isVerified) {
    throw { code: 'ALREADY_VERIFIED', msg: 'Phone is already verified.' };
  }

  const existingRecord = await OtpRepository.getLatestOtpRecord(userId, phone, purpose);

  let otp = generateOtp(6);
  let otpHash = hashOtp(otp);
  let expiresAt = new Date(Date.now() + 120 * 1000); // exactly 120 seconds

  if (existingRecord && new Date(existingRecord.expiresAt) > new Date() && !existingRecord.verified) {
    const updated = await OtpRepository.updateOtpRecordCount(existingRecord.id, otpHash, expiresAt);
    if (!updated) {
      throw { code: 'MAX_RETRIES_EXCEEDED', msg: 'Maximum OTP retries (3) exceeded for this request.' };
    }
  } else {
    await OtpRepository.createOtpRecord(userId, phone, otpHash, purpose, expiresAt);
  }

  await dispatchOtp(phone, otp);

  return { success: true, msg: 'OTP sent successfully', expiresIn: 120 };
}

export async function verifyOtp(userId, rawPhone, purpose, code) {
  const phone = toE164India(rawPhone);
  if (!phone) {
    throw { code: 'INVALID_PHONE', msg: 'Invalid phone number format.' };
  }

  const isVerified = await OtpRepository.getVerifiedPhone(userId, phone);
  if (isVerified) {
    return { success: true, msg: 'Phone already verified.' };
  }

  const record = await OtpRepository.getLatestOtpRecord(userId, phone, purpose);

  if (!record) {
    throw { code: 'INVALID_OTP', msg: 'No OTP request found.' };
  }

  if (record.verified) {
    return { success: true, msg: 'Phone already verified.' };
  }

  if (record.attempts >= record.maxAttempts) {
    throw { code: 'MAX_ATTEMPTS_EXCEEDED', msg: 'Too many incorrect attempts.' };
  }

  if (new Date(record.expiresAt) < new Date()) {
    throw { code: 'OTP_EXPIRED', msg: 'OTP has expired.' };
  }

  const inputHash = hashOtp(code);
  if (record.otpHash !== inputHash) {
    await OtpRepository.incrementOtpAttempts(record.id);
    throw { code: 'INVALID_OTP', msg: 'Invalid OTP.' };
  }

  const verificationToken = crypto.randomBytes(32).toString('hex');
  await db.transaction(async (tx) => {
    await OtpRepository.markOtpVerified(record.id, verificationToken);
    await OtpRepository.upsertVerifiedPhone(userId, phone);
  });

  return { success: true, verificationToken };
}

export async function checkAndConsumeVerificationToken(token) {
  const record = await OtpRepository.consumeVerificationToken(token);
  return record; // undefined if already consumed or invalid
}

export async function listVerifiedPhones(userId) {
  const records = await OtpRepository.getVerifiedPhones(userId);
  return { success: true, phones: records.map(r => ({ phone: r.phone, verifiedAt: r.verifiedAt })) };
}
