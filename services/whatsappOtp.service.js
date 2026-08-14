// services/whatsappOtp.service.js
//
// Thin wrapper around MSG91 for WhatsApp OTP delivery, with an automatic
// SMS fallback. The OTP itself is generated and verified by US, not by
// MSG91's built-in OTP widget — we already have Postgres + Redis + a
// timing-safe comparator (helpers/safeCompare.js) in this codebase, so
// self-managing the code gives full control over attempts/expiry/audit
// without depending on a second vendor-side state machine.
//
// ⚠️ BEFORE GOING LIVE: MSG91's exact request/response shape for the
// WhatsApp outbound-message API and the SMS API can change, and the
// WhatsApp OTP template itself must be created + Meta-approved inside
// your MSG91 dashboard first (Authentication template category). The
// endpoints and payload below reflect MSG91's documented v5 API shape —
// confirm field names against your dashboard's own API/Postman snippet
// (Dashboard -> WhatsApp -> your template -> "API" tab) before flipping
// COD_OTP_MODE to 'enforce', and test with one real phone number.
//
// Required env vars:
//   MSG91_AUTH_KEY                  - your MSG91 auth key
//   MSG91_WHATSAPP_INTEGRATED_NUMBER - the WhatsApp Business number configured in MSG91
//   MSG91_WHATSAPP_TEMPLATE_NAME     - name of the approved Authentication template
//   MSG91_WHATSAPP_NAMESPACE         - template namespace (from MSG91 dashboard)
//   MSG91_SMS_TEMPLATE_ID            - DLT-approved SMS template ID for the fallback
//                                       (WhatsApp doesn't need DLT registration; SMS still does)
//   MSG91_SMS_SENDER_ID              - your approved SMS sender ID (6 chars, e.g. DVDAUR)
//   COD_OTP_PEPPER                   - random secret string, mixed into the OTP hash

import crypto from 'crypto';
import { logger } from './logger.js';

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
  // crypto.randomInt avoids the modulo bias of Math.random()
  for (let i = 0; i < length; i++) {
    otp += digits[crypto.randomInt(0, digits.length)];
  }
  return otp;
}

export function hashOtp(otp) {
  return crypto.createHash('sha256').update(`${otp}:${PEPPER}`).digest('hex');
}

// India-only for now, matching the MSG91 pricing note this feature was
// scoped around: an Indian WhatsApp Business Account sending to a non-Indian
// number costs 20x+ more. Reject early rather than eat that silently.
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
    headers: {
      'Content-Type': 'application/json',
      'authkey': AUTH_KEY,
    },
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
                // Authentication templates in the Meta-approved format also
                // require the OTP as a quick-reply button payload — adjust
                // this key to match whatever your approved template actually
                // shows in its MSG91 "API" tab.
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
    headers: {
      'Content-Type': 'application/json',
      'authkey': AUTH_KEY,
    },
    body: JSON.stringify({
      template_id: SMS_TEMPLATE_ID,
      sender: SMS_SENDER_ID,
      short_url: '0',
      mobiles: to,
      OTP: otp, // variable name must match the {{OTP}} placeholder in your DLT-approved template
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.type === 'error') {
    throw new Error(data?.message || `MSG91 SMS send failed (${res.status})`);
  }
  return data;
}

/**
 * Sends the OTP via WhatsApp; if that call itself fails (bad number,
 * template/account issue, network error), falls back to SMS immediately
 * so the customer isn't left stuck. This is a synchronous "did the API
 * call succeed" fallback, not a delivery-receipt-based one — a proper
 * delivery-status fallback (via MSG91 webhooks) is a good phase-2
 * upgrade once you have real volume to tune it against.
 */
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
