// src/scripts/backfill-legacy-refunds.js
// Idempotent Backfill & Reconciliation of Legacy orders.refund_* to refunds Table

import { db } from '../db/client.js';
import { ordersTable, refundsTable } from '../db/schema/index.js';
import { sql, isNotNull, or, gt, eq } from 'drizzle-orm';
import pkg from 'uuid';
const { v4: uuidv4 } = pkg;

export async function runRefundsBackfill() {
  console.log('================================================================');
  console.log('🔄 STARTING HISTORICAL REFUND DATA BACKFILL & RECONCILIATION');
  console.log('================================================================');

  // 1. Fetch all orders with legacy refund data
  const legacyOrders = await db.select({
    id: ordersTable.id,
    refundId: ordersTable.refund_id,
    refundAmount: ordersTable.refund_amount,
    refundStatus: ordersTable.refund_status,
    refundSpeed: ordersTable.refund_speed,
    refundInitiatedAt: ordersTable.refund_initiated_at,
    refundCompletedAt: ordersTable.refund_completed_at,
    createdAt: ordersTable.createdAt,
  }).from(ordersTable).where(
    or(
      isNotNull(ordersTable.refund_id),
      gt(ordersTable.refund_amount, 0),
      isNotNull(ordersTable.refund_status)
    )
  );

  console.log(`Found ${legacyOrders.length} orders with legacy refund records.`);

  let insertedCount = 0;
  let alreadyExistsCount = 0;

  for (const order of legacyOrders) {
    // Check if matching refund record already exists for this order
    const [existing] = await db.select().from(refundsTable).where(
      eq(refundsTable.orderId, order.id)
    ).limit(1);

    if (existing) {
      alreadyExistsCount++;
    } else {
      const normalizedStatus = String(order.refundStatus || 'processed').toLowerCase();
      const amountPaise = Number(order.refundAmount) || 0;

      if (amountPaise > 0 || order.refundId) {
        await db.insert(refundsTable).values({
          id: uuidv4(),
          orderId: order.id,
          amount: amountPaise,
          refundStatus: normalizedStatus,
          refundSpeed: order.refundSpeed || 'optimum',
          gatewayRefundId: order.refundId || null,
          reason: 'Legacy order refund historical migration',
          createdAt: order.refundInitiatedAt || order.createdAt || new Date(),
          completedAt: order.refundCompletedAt || (normalizedStatus === 'processed' ? new Date() : null),
          updatedAt: new Date(),
        });
        insertedCount++;
      }
    }
  }

  console.log(`✅ Backfill processed: ${insertedCount} inserted, ${alreadyExistsCount} already existed.`);

  // 2. Perform Complete Reconciliation Verification
  console.log('\n--- RECONCILIATION VERIFICATION ---');

  const legacySummary = await db.execute(sql`
    SELECT 
      COUNT(*)::int as total_legacy_orders_with_refunds,
      COALESCE(SUM(refund_amount), 0)::bigint as total_legacy_refund_paise
    FROM orders 
    WHERE refund_amount > 0 OR refund_id IS NOT NULL
  `);

  const refundsSummary = await db.execute(sql`
    SELECT 
      COUNT(*)::int as total_refund_records,
      COUNT(DISTINCT order_id)::int as distinct_orders_with_refunds,
      COALESCE(SUM(amount), 0)::bigint as total_refunds_table_paise
    FROM refunds
  `);

  const leg = legacySummary.rows[0];
  const ref = refundsSummary.rows[0];

  console.log('Legacy Orders with Refunds:', leg);
  console.log('Refunds Table Summary:', ref);

  const distinctOrdersCovered = ref.distinct_orders_with_refunds >= leg.total_legacy_orders_with_refunds;
  const amountsCovered = BigInt(ref.total_refunds_table_paise) >= BigInt(leg.total_legacy_refund_paise);

  if (distinctOrdersCovered && amountsCovered) {
    console.log('================================================================');
    console.log('🎉 100% RECONCILIATION VERIFIED: refunds table fully encompasses all historical data.');
    console.log('================================================================');
    return true;
  } else {
    console.error('❌ RECONCILIATION FAILED: Historical data mismatch.');
    return false;
  }
}

// Allow direct execution
if (process.argv[1]?.endsWith('backfill-legacy-refunds.js')) {
  runRefundsBackfill().then(success => {
    process.exit(success ? 0 : 1);
  }).catch(err => {
    console.error('Fatal backfill error:', err);
    process.exit(1);
  });
}
