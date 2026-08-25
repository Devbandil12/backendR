// src/modules/risk/cod-risk.service.js
// Moved from: modules/risk/cod-risk.service.js
// Evaluates whether a COD checkout requires WhatsApp OTP verification.

import { db } from '../../db/client.js';
import {
  ordersTable,
  UserAddressTable,
  verifiedPhonesTable,
  codOtpDecisionLogTable,
} from '../../db/schema/index.js';
import { eq, and, gte, sql as dsql } from 'drizzle-orm';
import { redis } from '../../config/redis.js';
import { logger } from '../../observability/logger.js';

const HIGH_VALUE_THRESHOLD = Number(process.env.COD_OTP_HIGH_VALUE_THRESHOLD || 2000);
const RISKY_PINCODE_RATE = Number(process.env.COD_OTP_RISKY_PINCODE_RATE || 0.15);
const RISKY_PINCODE_MIN_SAMPLE = Number(process.env.COD_OTP_RISKY_PINCODE_MIN_SAMPLE || 3);
const TRUST_DAYS = Number(process.env.COD_OTP_TRUST_DAYS || 90);
const PINCODE_CACHE_TTL_SECONDS = Number(process.env.COD_OTP_PINCODE_CACHE_TTL || 6 * 60 * 60);

const FAILED_DELIVERY_STATUSES = ['RTO Initiated', 'Returned'];

async function getPincodeFailureRate(postalCode) {
  if (!postalCode) return { rate: 0, sample: 0 };

  const cacheKey = `cod-otp:pincode-rate:${postalCode}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch (err) {
    logger.warn('[codRiskEngine] Redis read failed, computing live', { err: err.message });
  }

  const rows = await db
    .select({ status: ordersTable.status, count: dsql`count(*)`.mapWith(Number) })
    .from(ordersTable)
    .innerJoin(UserAddressTable, eq(ordersTable.userAddressId, UserAddressTable.id))
    .where(and(eq(UserAddressTable.postalCode, postalCode), eq(ordersTable.paymentMode, 'cod')))
    .groupBy(ordersTable.status);

  const sample = rows.reduce((sum, r) => sum + r.count, 0);
  const failed = rows
    .filter((r) => FAILED_DELIVERY_STATUSES.includes(r.status))
    .reduce((sum, r) => sum + r.count, 0);

  const result = { rate: sample > 0 ? failed / sample : 0, sample };

  try {
    await redis.setex(cacheKey, PINCODE_CACHE_TTL_SECONDS, JSON.stringify(result));
  } catch (err) {
    logger.warn('[codRiskEngine] Redis write failed', { err: err.message });
  }

  return result;
}

async function hasVerifiedPhoneRecently(userId, phone) {
  const cutoff = new Date(Date.now() - TRUST_DAYS * 24 * 60 * 60 * 1000);
  const [row] = await db
    .select({ id: verifiedPhonesTable.id })
    .from(verifiedPhonesTable)
    .where(and(
      eq(verifiedPhonesTable.userId, userId),
      eq(verifiedPhonesTable.phone, phone),
      gte(verifiedPhonesTable.verifiedAt, cutoff)
    ))
    .limit(1);
  return !!row;
}

async function hasPriorCodOrder(userId) {
  const [row] = await db
    .select({ id: ordersTable.id })
    .from(ordersTable)
    .where(and(
      eq(ordersTable.userId, userId),
      eq(ordersTable.paymentMode, 'cod'),
      dsql`${ordersTable.status} != 'Order Cancelled'`
    ))
    .limit(1);
  return !!row;
}

async function isAddressPreviouslyUsed(userId, addressId) {
  if (!addressId) return false;
  const [row] = await db
    .select({ id: ordersTable.id })
    .from(ordersTable)
    .where(and(
      eq(ordersTable.userId, userId),
      eq(ordersTable.userAddressId, addressId),
      dsql`${ordersTable.status} != 'Order Cancelled'`
    ))
    .limit(1);
  return !!row;
}

export async function evaluateCodRisk({ userId, phone, address, cartTotal }) {
  const trustedPhone = await hasVerifiedPhoneRecently(userId, phone);
  if (trustedPhone) return { required: false, reasons: [], trustedPhone: true };

  const reasons = [];

  if (Number(cartTotal) >= HIGH_VALUE_THRESHOLD) reasons.push('high_order_value');

  const [priorCod, pincodeStats, addressUsedBefore] = await Promise.all([
    hasPriorCodOrder(userId),
    getPincodeFailureRate(address?.postalCode),
    isAddressPreviouslyUsed(userId, address?.id),
  ]);

  if (!addressUsedBefore) reasons.push('unverified_address');
  if (!priorCod) reasons.push('first_time_cod');
  if (pincodeStats.sample >= RISKY_PINCODE_MIN_SAMPLE && pincodeStats.rate >= RISKY_PINCODE_RATE) {
    reasons.push('risky_pincode');
  }

  return { required: reasons.length > 0, reasons, trustedPhone: false };
}

export function logOtpDecision({ userId, phone, postalCode, cartTotal, mode, required, reasons, orderId = null }) {
  db.insert(codOtpDecisionLogTable)
    .values({ userId, phone, postalCode, cartTotal, mode, required, reasons, orderId })
    .catch((err) => logger.error('[codRiskEngine] Failed to log OTP decision', { err: err.message }));
}

