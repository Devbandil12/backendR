// src/config/env.js
// Single source of truth for all environment variables.
// Import this wherever you need an env var — never read process.env directly.

import 'dotenv/config';

const required = (key) => {
  const val = process.env[key];
  if (!val) throw new Error(`❌ Missing required env var: ${key}`);
  return val;
};

const optional = (key, fallback = undefined) => process.env[key] ?? fallback;

export const env = {
  NODE_ENV: optional('NODE_ENV', 'development'),
  PORT: optional('PORT', '3000'),

  DATABASE_URL: required('DATABASE_URL'),
  REDIS_URL: required('REDIS_URL'),

  CLERK_SECRET_KEY: optional('CLERK_SECRET_KEY'),

  RAZORPAY_KEY_ID: optional('RAZORPAY_KEY_ID'),
  RAZORPAY_KEY_SECRET: optional('RAZORPAY_KEY_SECRET'),
  RAZORPAY_WEBHOOK_SECRET: optional('RAZORPAY_WEBHOOK_SECRET'),

  SHIPROCKET_EMAIL: optional('SHIPROCKET_EMAIL'),
  SHIPROCKET_PASSWORD: optional('SHIPROCKET_PASSWORD'),

  QUEUE_NAME: optional('QUEUE_NAME', 'email_queue_v2'),
  ORDER_CANCEL_WINDOW_MINUTES: Number(optional('ORDER_CANCEL_WINDOW_MINUTES', '60')),

  WEB_PUSH_PUBLIC_KEY: optional('WEB_PUSH_PUBLIC_KEY'),
  WEB_PUSH_PRIVATE_KEY: optional('WEB_PUSH_PRIVATE_KEY'),
  WEB_PUSH_EMAIL: optional('WEB_PUSH_EMAIL'),

  WHATSAPP_API_URL: optional('WHATSAPP_API_URL'),
  WHATSAPP_API_TOKEN: optional('WHATSAPP_API_TOKEN'),

  COD_OTP_MODE: optional('COD_OTP_MODE', 'shadow'), // 'shadow' | 'enforce'

  RESEND_API_KEY: optional('RESEND_API_KEY'),
  ADMIN_EMAIL: optional('ADMIN_EMAIL'),
};
