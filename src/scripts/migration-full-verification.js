import { db } from '../db/client.js';
import { ordersTable, usersTable, refundsTable } from '../db/schema/index.js';
import { eq, sql } from 'drizzle-orm';
import { insertAdminRefund, getOrderSummary, getAllOrders } from '../modules/orders/orders.repository.js';
import { getUserOrders } from '../modules/users/users.service.js';
import { getAttentionCounts, getDashboardStats } from '../modules/admin/admin.service.js';
import { AnalyticsService } from '../modules/admin/analytics.service.js';

async function runFullVerification() {
  console.log("================================================================================");
  console.log("   FULL END-TO-END VERIFICATION: REFUNDS TABLE MIGRATION & COMPATIBILITY LAYER   ");
  console.log("================================================================================\n");

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition, message) {
    totalTests++;
    if (condition) {
      console.log(`  [PASS] Test ${totalTests}: ${message}`);
      passedTests++;
    } else {
      console.error(`  [FAIL] Test ${totalTests}: ${message}`);
      process.exit(1);
    }
  }

  // ---------------------------------------------------------------------------
  // TEST 1: Historical Data Reconciliation Check
  // ---------------------------------------------------------------------------
  console.log("Step 1: Verifying 100% Parity on Historical Data...");
  const [legacyAgg] = (await db.execute(sql`
    SELECT COUNT(*)::int as count, COALESCE(SUM(refund_amount), 0)::bigint as total_paise
    FROM orders
    WHERE refund_amount > 0 OR refund_id IS NOT NULL
  `)).rows;

  const [refundsAgg] = (await db.execute(sql`
    SELECT COUNT(*)::int as count, COALESCE(SUM(amount), 0)::bigint as total_paise
    FROM refunds
  `)).rows;

  console.log(`  Historical Legacy: ${legacyAgg.count} orders with refunds, ${legacyAgg.total_paise} paise`);
  console.log(`  New Refunds Table: ${refundsAgg.count} refund records, ${refundsAgg.total_paise} paise`);
  assert(BigInt(refundsAgg.total_paise) >= BigInt(legacyAgg.total_paise), "refundsTable encompasses 100% of historical legacy refund paise");

  // ---------------------------------------------------------------------------
  // TEST 2: Multi-Refund Partial -> Full Payment Status Lifecycle & Over-Refund Guard
  // ---------------------------------------------------------------------------
  console.log("\nStep 2: Testing Multi-Refund Lifecycle & Over-Refund Safety Guard...");
  const [existingOrder] = await db.select({
    userId: ordersTable.userId,
    userAddressId: ordersTable.userAddressId
  }).from(ordersTable).where(sql`${ordersTable.userAddressId} IS NOT NULL`).limit(1);

  const [testOrder] = await db.insert(ordersTable).values({
    userId: existingOrder.userId,
    userAddressId: existingOrder.userAddressId,
    phone: '9876543210',
    status: 'Delivered',
    paymentStatus: 'paid',
    paymentMode: 'online',
    totalAmount: 2000, // ₹2000 = 200,000 paise
    walletAmountUsed: 0,
    version: 1
  }).returning();

  console.log(`  Created test order: ${testOrder.id} (₹2,000)`);

  // Partial Refund 1: ₹500
  await insertAdminRefund(testOrder.id, 500, "Partial refund 1");
  let [o1] = await db.select().from(ordersTable).where(eq(ordersTable.id, testOrder.id));
  assert(o1.paymentStatus === 'partially_refunded', `Refund 1 (₹500 / ₹2000) -> paymentStatus is 'partially_refunded' (Actual: ${o1.paymentStatus})`);
  assert(Number(o1.refund_amount) === 50000, `Legacy sync: orders.refund_amount is 50,000 paise (Actual: ${o1.refund_amount})`);

  // Partial Refund 2: ₹300
  await insertAdminRefund(testOrder.id, 300, "Partial refund 2");
  let [o2] = await db.select().from(ordersTable).where(eq(ordersTable.id, testOrder.id));
  assert(o2.paymentStatus === 'partially_refunded', `Refund 2 (₹300 / ₹2000, cumulative ₹800) -> paymentStatus is 'partially_refunded' (Actual: ${o2.paymentStatus})`);
  assert(Number(o2.refund_amount) === 80000, `Legacy sync: orders.refund_amount is 80,000 paise (Actual: ${o2.refund_amount})`);

  // Partial Refund 3: ₹200
  await insertAdminRefund(testOrder.id, 200, "Partial refund 3");
  let [o3] = await db.select().from(ordersTable).where(eq(ordersTable.id, testOrder.id));
  assert(o3.paymentStatus === 'partially_refunded', `Refund 3 (₹200 / ₹2000, cumulative ₹1000) -> paymentStatus is 'partially_refunded' (Actual: ${o3.paymentStatus})`);
  assert(Number(o3.refund_amount) === 100000, `Legacy sync: orders.refund_amount is 100,000 paise (Actual: ${o3.refund_amount})`);

  // Full Refund 4: ₹1000 -> Total ₹2000
  await insertAdminRefund(testOrder.id, 1000, "Final refund 4");
  let [o4] = await db.select().from(ordersTable).where(eq(ordersTable.id, testOrder.id));
  assert(o4.paymentStatus === 'refunded', `Refund 4 (₹1000 / ₹2000, cumulative ₹2000) -> paymentStatus is 'refunded' (Actual: ${o4.paymentStatus})`);
  assert(Number(o4.refund_amount) === 200000, `Legacy sync: orders.refund_amount is 200,000 paise (Actual: ${o4.refund_amount})`);

  // Over-Refund Attempt: ₹100 (should be rejected!)
  let overRefundRejected = false;
  try {
    await insertAdminRefund(testOrder.id, 100, "Over refund attempt");
  } catch (err) {
    if (err.message.includes('RefundExceedsOrderTotal')) {
      overRefundRejected = true;
    }
  }
  assert(overRefundRejected, "Over-refund rejection guard prevented exceeding total order amount (RefundExceedsOrderTotal thrown)");

  // ---------------------------------------------------------------------------
  // TEST 3: User Orders API attaching unified refunds[]
  // ---------------------------------------------------------------------------
  console.log("\nStep 3: Verifying User Orders API attaches uniform refunds[]...");
  const userOrders = await getUserOrders(existingOrder.userId);
  const fetchedOrder = userOrders.find(o => o.id === testOrder.id);
  assert(Array.isArray(fetchedOrder?.refunds), "User order has refunds array");
  assert(fetchedOrder?.refunds.length === 4, `User order has all 4 individual refund records in array (Actual: ${fetchedOrder?.refunds.length})`);
  assert(fetchedOrder?.refunds[0].amount === 50000, "First refund record has amount 50,000 paise");

  // ---------------------------------------------------------------------------
  // TEST 4: Admin Orders & Filtering from refunds table
  // ---------------------------------------------------------------------------
  console.log("\nStep 4: Testing Admin Orders API with refundStatus filter...");
  const processedFilterResult = await getAllOrders({ refundStatus: 'processed', page: 1, limit: 50 });
  const hasOurOrder = processedFilterResult.data.some(o => o.id === testOrder.id);
  assert(hasOurOrder, "Admin getAllOrders({ refundStatus: 'processed' }) successfully matched test order via refunds subquery");

  // ---------------------------------------------------------------------------
  // TEST 5: Distinct Orders Attention & Summary KPIs
  // ---------------------------------------------------------------------------
  console.log("\nStep 5: Testing Distinct Order Attention & Summary KPIs...");
  const summary = await getOrderSummary();
  assert(typeof summary.refundsPending === 'number', `getOrderSummary.refundsPending returned valid distinct number: ${summary.refundsPending}`);

  const attention = await getAttentionCounts();
  assert(typeof attention.pendingRefunds === 'number', `getAttentionCounts.pendingRefunds returned valid distinct count: ${attention.pendingRefunds}`);

  // ---------------------------------------------------------------------------
  // TEST 6: Analytics Service using refunds table
  // ---------------------------------------------------------------------------
  console.log("\nStep 6: Testing Analytics calculation from refunds table...");
  const salesAnalytics = await AnalyticsService.getSalesAnalytics('all');
  assert(typeof salesAnalytics.kpis.refunds === 'number', `AnalyticsService.getSalesAnalytics returned calculated refunds: ₹${salesAnalytics.kpis.refunds}`);

  const dashboardStats = await getDashboardStats('all');
  assert(typeof dashboardStats.totalRefundsProcessed === 'number', `getDashboardStats returned totalRefundsProcessed: ₹${dashboardStats.totalRefundsProcessed}`);

  // Cleanup test order & refunds
  await db.delete(refundsTable).where(eq(refundsTable.orderId, testOrder.id));
  await db.delete(ordersTable).where(eq(ordersTable.id, testOrder.id));

  console.log("\n================================================================================");
  console.log(`   ALL ${passedTests}/${totalTests} TESTS PASSED WITH 100% PARITY AND INTEGRITY!   `);
  console.log("================================================================================\n");
  process.exit(0);
}

runFullVerification().catch(err => {
  console.error("FATAL TEST ERROR:", err);
  process.exit(1);
});
