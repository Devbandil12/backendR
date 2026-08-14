// helpers/codRiskEngine.js
//
// Decides whether a given COD checkout should require a WhatsApp OTP
// before the order is created. Deliberately does NOT gate every COD
// order — only the ones that actually look risky. Four signals, any one
// of which is enough to require verification:
//
//   1. high_order_value      cart total >= COD_OTP_HIGH_VALUE_THRESHOLD
//   2. unverified_address    address has never been used on a delivered order
//   3. first_time_cod        user has no prior (non-cancelled) COD order
//   4. risky_pincode         this pincode's own COD orders have an RTO/return
//                            rate above COD_OTP_RISKY_PINCODE_RATE, with at
//                            least COD_OTP_RISKY_PINCODE_MIN_SAMPLE orders
//                            to make that rate meaningful
//
// A phone the user has already verified once (see verifiedPhonesTable) is
// trusted for COD_OTP_TRUST_DAYS and skips all of the above — repeat
// customers should never see this screen twice.
//
// NOTE on signal #4: it's a proxy, not a clean RTO metric. `orders.status`
// of 'Returned' covers both COD-refusal RTOs (Shiprocket 'RTO DELIVERED')
// and genuine product returns ('RETURN DELIVERED') — see routes/shiprocket.js.
// That's fine for a first pass (both outcomes mean "this pincode is
// expensive to ship COD to"), but if you want a cleaner number later,
// log the Shiprocket raw status separately instead of reusing `status`.

import { db } from '../configs/index.js';
import { ordersTable, UserAddressTable, verifiedPhonesTable, codOtpDecisionLogTable } from '../configs/schema.js';
import { eq, and, inArray, gte, sql as dsql } from 'drizzle-orm';
import { redis } from '../configs/redis.js';
import { logger } from '../services/logger.js';

const HIGH_VALUE_THRESHOLD = Number(process.env.COD_OTP_HIGH_VALUE_THRESHOLD || 2000);
const RISKY_PINCODE_RATE = Number(process.env.COD_OTP_RISKY_PINCODE_RATE || 0.15); // 15%
const RISKY_PINCODE_MIN_SAMPLE = Number(process.env.COD_OTP_RISKY_PINCODE_MIN_SAMPLE || 3);
const TRUST_DAYS = Number(process.env.COD_OTP_TRUST_DAYS || 90);
const PINCODE_CACHE_TTL_SECONDS = Number(process.env.COD_OTP_PINCODE_CACHE_TTL || 6 * 60 * 60); // 6h

const FAILED_DELIVERY_STATUSES = ['RTO Initiated', 'Returned'];

// 🟢 Cached, since this is a groupBy query we don't want firing on every
// checkout keystroke. Redis is already a hard dependency of this codebase
// (rate limiter, idempotency, cache) so no new infra here.
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
    .where(and(
      eq(UserAddressTable.postalCode, postalCode),
      eq(ordersTable.paymentMode, 'cod')
    ))
    .groupBy(ordersTable.status);

  const sample = rows.reduce((sum, r) => sum + r.count, 0);
  const failed = rows
    .filter(r => FAILED_DELIVERY_STATUSES.includes(r.status))
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

/**
 * evaluateCodRisk
 * @param {{ userId: string, phone: string, address: object, cartTotal: number }} params
 * @returns {Promise<{ required: boolean, reasons: string[], trustedPhone: boolean }>}
 */
export async function evaluateCodRisk({ userId, phone, address, cartTotal }) {
  const trustedPhone = await hasVerifiedPhoneRecently(userId, phone);
  if (trustedPhone) {
    return { required: false, reasons: [], trustedPhone: true };
  }

  const reasons = [];

  if (Number(cartTotal) >= HIGH_VALUE_THRESHOLD) {
    reasons.push('high_order_value');
  }

  // 🟢 FIXED (Part A5): previously read `address.isVerified`, a column
  // addressController.js accepted straight from the request body — a
  // client could mark any address "verified" with no OTP ever completed.
  // This now checks something the client can't forge: has this exact
  // address ever actually been used on a completed order before.
  const [priorCod, pincodeStats, addressUsedBefore] = await Promise.all([
    hasPriorCodOrder(userId),
    getPincodeFailureRate(address?.postalCode),
    isAddressPreviouslyUsed(userId, address?.id),
  ]);

  if (!addressUsedBefore) {
    reasons.push('unverified_address');
  }

  if (!priorCod) {
    reasons.push('first_time_cod');
  }

  if (pincodeStats.sample >= RISKY_PINCODE_MIN_SAMPLE && pincodeStats.rate >= RISKY_PINCODE_RATE) {
    reasons.push('risky_pincode');
  }

  return { required: reasons.length > 0, reasons, trustedPhone: false };
}

/**
 * Writes one row per checkout risk decision — used both in shadow mode
 * (to see what enforcement WOULD have done) and in enforce mode (as an
 * audit trail). Fire-and-forget: a logging failure should never block
 * or fail a checkout.
 */
export function logOtpDecision({ userId, phone, postalCode, cartTotal, mode, required, reasons, orderId = null }) {
  db.insert(codOtpDecisionLogTable).values({
    userId, phone, postalCode, cartTotal, mode, required, reasons, orderId,
  }).catch(err => logger.error('[codRiskEngine] Failed to log OTP decision', { err: err.message }));
}
