// src/modules/orders/refunds.compatibility.js
// Centralized Refund Compatibility & Dual-Synchronization Layer

import { db } from '../../db/client.js';
import { ordersTable, refundsTable, orderTimeline } from '../../db/schema/index.js';
import { eq, and, sql } from 'drizzle-orm';
import pkg from 'uuid';
const { v4: uuidv4 } = pkg;

/**
 * Helper: Safely converts various timestamp representations (Unix s/ms, ISO strings, Date objects) to Date object.
 */
export const safeDate = (timestamp) => {
  if (!timestamp) return null;
  if (timestamp instanceof Date) return timestamp;
  if (typeof timestamp === 'number') {
    return new Date(timestamp > 1e11 ? timestamp : timestamp * 1000);
  }
  const d = new Date(timestamp);
  return isNaN(d.getTime()) ? null : d;
};

/**
 * Normalizes status to lowercase legacy standard: 'pending', 'in_progress', 'processed', 'failed'.
 */
export const normalizeRefundStatus = (status) => {
  if (!status) return 'pending';
  const s = String(status).trim().toLowerCase();
  if (s === 'completed' || s === 'processed' || s === 'success') return 'processed';
  if (s === 'processing' || s === 'in_progress') return 'in_progress';
  if (s === 'failed' || s === 'error') return 'failed';
  if (s === 'pending' || s === 'created' || s === 'queued') return 'pending';
  return s;
};

/**
 * Centralized Refund Processing Service.
 * 
 * Guarantees that:
 * 1. A row exists in `refundsTable` with:
 *    - `amount` in PAISE (100 paise = ₹1.00)
 *    - `refundStatus` in lowercase format ('pending', 'in_progress', 'processed', 'failed')
 *    - `refundSpeed`, `gatewayRefundId`, `createdAt`, `completedAt`
 * 2. The order payment status is dynamically transitioned:
 *    - Processed refunds >= order total -> paymentStatus = 'refunded'
 *    - Processed refunds > 0 and < order total -> paymentStatus = 'partially_refunded'
 *    - Full cancellation with gateway deduction -> paymentStatus = 'refunded'
 * 3. Idempotent: If `gatewayRefundId` matches an existing row in `refundsTable`, updates it instead of creating duplicates.
 */
export const recordRefund = async ({
  orderId,
  amount, // In PAISE (e.g. ₹999 -> 99900)
  amountInPaise,
  refundStatus = 'pending',
  gatewayRefundId = null,
  refundSpeed = null,
  reason = null,
  returnId = null,
  createdAt = null,
  completedAt = null,
  expectedVersion = null,
  tx = null
}) => {
  const client = tx || db;
  const normalizedStatus = normalizeRefundStatus(refundStatus);
  const initiatedDate = safeDate(createdAt) || new Date();
  const completedDate = normalizedStatus === 'processed' ? (safeDate(completedAt) || new Date()) : safeDate(completedAt);
  const rawAmt = amount !== undefined && amount !== null ? amount : amountInPaise;
  const paiseAmount = Math.round(Number(rawAmt)) || 0;

  // 1. Check if refund record already exists by gatewayRefundId (Idempotency protection)
  let existingRefund = null;
  if (gatewayRefundId) {
    const rows = await client.select().from(refundsTable).where(eq(refundsTable.gatewayRefundId, gatewayRefundId)).limit(1);
    existingRefund = rows[0] || null;
  }

  let refundRecord;
  if (existingRefund) {
    // Update existing refund record
    const [updated] = await client.update(refundsTable)
      .set({
        amount: paiseAmount || existingRefund.amount,
        refundStatus: normalizedStatus,
        refundSpeed: refundSpeed || existingRefund.refundSpeed,
        completedAt: completedDate || existingRefund.completedAt,
        reason: reason || existingRefund.reason,
        returnId: returnId || existingRefund.returnId,
        updatedAt: new Date(),
      })
      .where(eq(refundsTable.id, existingRefund.id))
      .returning();
    refundRecord = updated;
  } else {
    // Insert new refund record
    const [inserted] = await client.insert(refundsTable).values({
      id: uuidv4(),
      orderId,
      returnId: returnId || null,
      amount: paiseAmount,
      refundStatus: normalizedStatus,
      refundSpeed: refundSpeed || 'optimum',
      gatewayRefundId: gatewayRefundId || null,
      reason: reason || null,
      createdAt: initiatedDate,
      completedAt: completedDate,
      updatedAt: new Date(),
    }).returning();
    refundRecord = inserted;
  }

  // 2. Fetch order to know total order amount in paise
  const [currentOrder] = await client.select({
    totalAmount: ordersTable.totalAmount,
    walletAmountUsed: ordersTable.walletAmountUsed,
    paymentStatus: ordersTable.paymentStatus,
    status: ordersTable.status
  }).from(ordersTable).where(eq(ordersTable.id, orderId));

  const orderTotalRupees = (Number(currentOrder?.totalAmount) || 0) + (Number(currentOrder?.walletAmountUsed) || 0);
  const orderTotalPaise = Math.round(orderTotalRupees * 100);

  // Fetch all refunds for this order to aggregate total refund amount
  const allRefundsForOrder = await client.select().from(refundsTable).where(eq(refundsTable.orderId, orderId));
  const totalRefundPaise = allRefundsForOrder.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  const processedRefundPaise = allRefundsForOrder
    .filter(r => r.refundStatus === 'processed')
    .reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

  // 3. Update order payment status (partial vs full refund) with version increment
  let orderCondition = eq(ordersTable.id, orderId);
  if (expectedVersion !== null) {
    orderCondition = and(orderCondition, eq(ordersTable.version, expectedVersion));
  }

  const orderUpdateData = {
    updatedAt: new Date(),
  };

  // Business Rule: Differentiate partial refund vs full refund
  if (orderTotalPaise > 0 && processedRefundPaise >= orderTotalPaise) {
    orderUpdateData.paymentStatus = 'refunded';
  } else if (currentOrder?.status === 'Order Cancelled' && orderTotalPaise > 0 && processedRefundPaise >= Math.floor(orderTotalPaise * 0.94)) {
    // Full cancellation with 5% payment gateway deduction
    orderUpdateData.paymentStatus = 'refunded';
  } else if (processedRefundPaise > 0) {
    orderUpdateData.paymentStatus = 'partially_refunded';
  }

  if (expectedVersion !== null) {
    orderUpdateData.version = expectedVersion + 1;
  } else {
    orderUpdateData.version = sql`${ordersTable.version} + 1`;
  }

  const [updatedOrder] = await client.update(ordersTable)
    .set(orderUpdateData)
    .where(orderCondition)
    .returning();

  if (!updatedOrder && expectedVersion !== null) {
    throw new Error("ConcurrencyConflict: Order has been modified by another process. Please refresh and try again.");
  }

  return {
    refund: refundRecord,
    order: updatedOrder
  };
};

/**
 * Convenience synchronizer for Razorpay webhook / API refund entities.
 */
export const syncRazorpayRefundEntity = async (orderIdOrObj, entityArg = null, txArg = null) => {
  let orderId, entity, tx;
  if (typeof orderIdOrObj === 'object' && orderIdOrObj !== null && !entityArg) {
    ({ orderId, entity, tx } = orderIdOrObj);
  } else {
    orderId = orderIdOrObj;
    entity = entityArg;
    tx = txArg;
  }
  if (!entity || !orderId) return null;

  return await recordRefund({
    orderId,
    amount: entity.amount, // Already in paise from Razorpay
    refundStatus: entity.status, // 'processed', 'pending', etc.
    gatewayRefundId: entity.id,
    refundSpeed: entity.speed_processed || entity.speed_requested || 'optimum',
    createdAt: entity.created_at ? safeDate(entity.created_at) : new Date(),
    completedAt: (entity.status === 'processed' && entity.processed_at) ? safeDate(entity.processed_at) : null,
    tx
  });
};
