// src/modules/verification/checkout-otp/whatsapp-otp.service.js
// Moved from: infrastructure/messaging/whatsapp/index.js

import crypto from 'crypto';
import { logger } from '../../../observability/logger.js';

const AUTH_KEY = process.env.MSG91_AUTH_KEY;
const WA_INTEGRATED_NUMBER = process.env.MSG91_WHATSAPP_INTEGRATED_NUMBER;
const WA_TEMPLATE_NAME = process.env.MSG91_WHATSAPP_TEMPLATE_NAME;
const WA_NAMESPACE = process.env.MSG91_WHATSAPP_NAMESPACE;
const SMS_TEMPLATE_ID = process.env.MSG91_SMS_TEMPLATE_ID;
const SMS_SENDER_ID = process.env.MSG91_SMS_SENDER_ID;
const PEPPER = process.env.COD_OTP_PEPPER || 'change-me-in-env';

const WA_SEND_URL = 'https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/';
const SMS_SEND_URL = 'https://control.msg91.com/api/v5/flow/';

export function generateOtp(length = 6) {
  const digits = '0123456789';
  let otp = '';
  for (let i = 0; i < length; i++) {
    otp += digits[crypto.randomInt(0, digits.length)];
  }
  return otp;
}

export function hashOtp(otp) {
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
          namespace: WA_NAMESPACE,
          to_and_components: [
            {
              to: [to],
              components: {
                body_1: { type: 'text', value: otp },
                button_1: { subtype: 'url', type: 'text', value: otp },
              },
            },
          ],
        },
      },
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.status === 'error' || data?.type === 'error') {
    throw new Error(data?.message || `MSG91 WhatsApp send failed (${res.status})`);
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

export async function sendWhatsAppOtp(phone, otp) {
  return dispatchOtp(phone, otp);
}

export async function dispatchOtp(phone, otp) {
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

export function maskPhone(phone) {
  const digits = String(phone).replace(/\D/g, '').slice(-10);
  if (digits.length !== 10) return '••••••••••';
  return `+91 ${digits.slice(0, 2)}••••••${digits.slice(-2)}`;
}
