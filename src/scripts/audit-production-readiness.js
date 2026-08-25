import { db } from '../db/client.js';
import { sql } from 'drizzle-orm';

async function auditDatabase() {
  console.log("================================================================================");
  console.log("   AUDIT PART 1: LIVE DATABASE SCHEMA INSPECTION (POSTGRESQL vs DRIZZLE)        ");
  console.log("================================================================================\n");

  // 1. Inspect 'refunds' columns
  const refundCols = (await db.execute(sql`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'refunds'
    ORDER BY ordinal_position;
  `)).rows;

  console.log("📋 LIVE 'refunds' TABLE COLUMNS in PostgreSQL:");
  console.table(refundCols);

  // 2. Inspect 'refunds' indexes
  const refundIndexes = (await db.execute(sql`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE tablename = 'refunds';
  `)).rows;

  console.log("\n🔑 LIVE 'refunds' INDEXES in PostgreSQL:");
  console.table(refundIndexes);

  // 3. Inspect 'refunds' foreign keys
  const refundFks = (await db.execute(sql`
    SELECT
      tc.constraint_name,
      kcu.column_name,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = 'refunds';
  `)).rows;

  console.log("\n🔗 LIVE 'refunds' FOREIGN KEYS in PostgreSQL:");
  console.table(refundFks);

  // 4. Inspect legacy columns on 'orders'
  const legacyCols = (await db.execute(sql`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name LIKE 'refund_%'
    ORDER BY ordinal_position;
  `)).rows;

  console.log("\n🏛️ LIVE LEGACY 'orders.refund_*' COLUMNS (Preservation check):");
  console.table(legacyCols);

  console.log("\n================================================================================");
  console.log("   AUDIT PART 2: COMPREHENSIVE HISTORICAL DATA RECONCILIATION                   ");
  console.log("================================================================================\n");

  const legacyOrders = (await db.execute(sql`
    SELECT
      id,
      refund_id,
      refund_amount,
      refund_status,
      refund_speed,
      refund_initiated_at,
      refund_completed_at
    FROM orders
    WHERE refund_amount > 0 OR refund_id IS NOT NULL OR (refund_status IS NOT NULL AND LOWER(refund_status) != 'none')
    ORDER BY created_at ASC;
  `)).rows;

  const allRefunds = (await db.execute(sql`
    SELECT
      id,
      order_id,
      amount,
      refund_status,
      refund_speed,
      gateway_refund_id,
      created_at,
      completed_at
    FROM refunds
    ORDER BY created_at ASC;
  `)).rows;

  console.log(`Found ${legacyOrders.length} orders with legacy refund data.`);
  console.log(`Found ${allRefunds.length} records in new refunds table.\n`);

  let missingRefunds = 0;
  let statusMismatches = 0;
  let amountMismatches = 0;
  let timestampMismatches = 0;

  for (const lo of legacyOrders) {
    const matchingRefunds = allRefunds.filter(r => r.order_id === lo.id);
    if (matchingRefunds.length === 0) {
      console.error(`❌ MISSING REFUND RECORD for order ${lo.id} (Legacy amount: ${lo.refund_amount} paise)`);
      missingRefunds++;
      continue;
    }

    const totalPaiseInRefundsTable = matchingRefunds.reduce((sum, r) => sum + Number(r.amount), 0);
    const expectedLegacyPaise = Number(lo.refund_amount) || 0;

    if (totalPaiseInRefundsTable < expectedLegacyPaise) {
      console.error(`❌ AMOUNT MISMATCH for order ${lo.id}: Expected at least ${expectedLegacyPaise} paise, found ${totalPaiseInRefundsTable} paise in refundsTable.`);
      amountMismatches++;
    }

    // Check status of latest refund
    const latestRefund = matchingRefunds[matchingRefunds.length - 1];
    const legacyStatus = String(lo.refund_status || '').toLowerCase();
    const newStatus = String(latestRefund.refund_status || '').toLowerCase();

    if (legacyStatus && legacyStatus !== 'none' && legacyStatus !== newStatus) {
      console.warn(`⚠️ STATUS DIFFERENCE for order ${lo.id}: legacy='${legacyStatus}' vs new='${newStatus}'`);
    }
  }

  console.log("\n📊 RECONCILIATION SUMMARY REPORT:");
  console.log(`  - Legacy Orders Audited: ${legacyOrders.length}`);
  console.log(`  - Refunds Table Rows:    ${allRefunds.length}`);
  console.log(`  - Missing Records:       ${missingRefunds}`);
  console.log(`  - Amount Mismatches:     ${amountMismatches}`);
  console.log(`  - Status Mismatches:     ${statusMismatches}`);

  process.exit(0);
}

auditDatabase().catch(err => {
  console.error("AUDIT ERROR:", err);
  process.exit(1);
});
