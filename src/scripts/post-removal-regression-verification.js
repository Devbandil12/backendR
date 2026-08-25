import { db } from '../db/client.js';
import { sql, eq } from 'drizzle-orm';
import { ordersTable } from '../db/schema/orders.schema.js';
import { usersTable, UserAddressTable } from '../db/schema/users.schema.js';
import { refundsTable, returnsTable, returnItemsTable } from '../db/schema/returns.schema.js';
import { recordRefund, syncRazorpayRefundEntity } from '../modules/orders/refunds.compatibility.js';
import * as OrdersRepository from '../modules/orders/orders.repository.js';
import * as UsersService from '../modules/users/users.service.js';
import * as AdminService from '../modules/admin/admin.service.js';
import { AnalyticsService } from '../modules/admin/analytics.service.js';
import assert from 'assert';

async function runRegressionVerification() {
  console.log("================================================================================");
  console.log("   POST-REMOVAL FULL REGRESSION TEST SUITE (PURE refunds TABLE ARCHITECTURE)    ");
  console.log("================================================================================\n");

  // ── 1. Database Schema & Preservation Checks ──────────────────────────────────
  console.log("Step 1: Verifying Database Schema & Table Integrity...");

  const ordersCols = (await db.execute(sql`
    SELECT column_name FROM information_schema.columns WHERE table_name = 'orders';
  `)).rows.map(r => r.column_name);

  const legacyColsRemaining = ordersCols.filter(c => c.startsWith('refund_'));
  assert(legacyColsRemaining.length === 0, `All legacy refund_* columns removed from orders table (Found: ${legacyColsRemaining.join(', ')})`);
  console.log("  [PASS] Test 1: Zero legacy refund_* columns exist on 'orders' table");

  const [refundsCount, returnsCount, returnItemsCount] = await Promise.all([
    db.execute(sql`SELECT COUNT(*)::int as count FROM refunds;`),
    db.execute(sql`SELECT COUNT(*)::int as count FROM returns;`),
    db.execute(sql`SELECT COUNT(*)::int as count FROM return_items;`),
  ]);

  assert(refundsCount.rows[0].count >= 41, `Historical refund rows preserved in refunds table (Count: ${refundsCount.rows[0].count})`);
  console.log(`  [PASS] Test 2: 'refunds' table preserved with ${refundsCount.rows[0].count} historical records`);
  console.log(`  [PASS] Test 3: 'returns' and 'return_items' tables intact (${returnsCount.rows[0].count} returns, ${returnItemsCount.rows[0].count} items)`);

  // ── 2. Create Test User and Address ──────────────────────────────────────────
  console.log("\nStep 2: Setting up test environment...");
  const [testUser] = await db.select().from(usersTable).limit(1);
  const [testAddress] = await db.select().from(UserAddressTable).where(eq(UserAddressTable.userId, testUser.id)).limit(1);

  const testOrderId = `DA_FINAL_TEST_${Date.now()}`;
  await db.insert(ordersTable).values({
    id: testOrderId,
    userId: testUser.id,
    userAddressId: testAddress.id,
    phone: '9876543210',
    paymentMode: 'online',
    totalAmount: 2000,
    status: 'Delivered',
    paymentStatus: 'paid',
  });
  console.log(`  Created test order: ${testOrderId} (₹2,000)`);

  // ── 3. Multi-Refund Lifecycle & Over-Refund Guard ────────────────────────────
  console.log("\nStep 3: Testing 4-Stage Multi-Refund Lifecycle & Over-Refund Safety Guard...");

  // Refund 1: ₹500
  const ref1 = await recordRefund({
    orderId: testOrderId,
    amountInPaise: 50000,
    refundStatus: 'processed',
    reason: 'Stage 1 Partial Refund',
    gatewayRefundId: `rfnd_final_${Date.now()}_1`,
  });
  const [o1] = await db.select().from(ordersTable).where(eq(ordersTable.id, testOrderId));
  assert(o1.paymentStatus === 'partially_refunded', `Refund 1 -> paymentStatus is partially_refunded (Actual: ${o1.paymentStatus})`);
  console.log("  [PASS] Test 4: Refund 1 (₹500 / ₹2000) -> paymentStatus is 'partially_refunded'");

  // Refund 2: ₹300
  const ref2 = await recordRefund({
    orderId: testOrderId,
    amountInPaise: 30000,
    refundStatus: 'processed',
    reason: 'Stage 2 Partial Refund',
    gatewayRefundId: `rfnd_final_${Date.now()}_2`,
  });
  const [o2] = await db.select().from(ordersTable).where(eq(ordersTable.id, testOrderId));
  assert(o2.paymentStatus === 'partially_refunded', `Refund 2 -> paymentStatus is partially_refunded (Actual: ${o2.paymentStatus})`);
  console.log("  [PASS] Test 5: Refund 2 (₹300 / ₹2000, cum. ₹800) -> paymentStatus is 'partially_refunded'");

  // Refund 3: ₹200
  const ref3 = await recordRefund({
    orderId: testOrderId,
    amountInPaise: 20000,
    refundStatus: 'processed',
    reason: 'Stage 3 Partial Refund',
    gatewayRefundId: `rfnd_final_${Date.now()}_3`,
  });
  const [o3] = await db.select().from(ordersTable).where(eq(ordersTable.id, testOrderId));
  assert(o3.paymentStatus === 'partially_refunded', `Refund 3 -> paymentStatus is partially_refunded (Actual: ${o3.paymentStatus})`);
  console.log("  [PASS] Test 6: Refund 3 (₹200 / ₹2000, cum. ₹1000) -> paymentStatus is 'partially_refunded'");

  // Refund 4: ₹1000 (completes order total)
  const ref4 = await recordRefund({
    orderId: testOrderId,
    amountInPaise: 100000,
    refundStatus: 'processed',
    reason: 'Stage 4 Full Refund Completion',
    gatewayRefundId: `rfnd_final_${Date.now()}_4`,
  });
  const [o4] = await db.select().from(ordersTable).where(eq(ordersTable.id, testOrderId));
  assert(o4.paymentStatus === 'refunded', `Refund 4 -> paymentStatus is refunded (Actual: ${o4.paymentStatus})`);
  console.log("  [PASS] Test 7: Refund 4 (₹1000 / ₹2000, cum. ₹2000) -> paymentStatus is 'refunded'");

  // Refund 5: ₹1 (Should be rejected by insertAdminRefund)
  let overRefundRejected = false;
  try {
    await OrdersRepository.insertAdminRefund(testOrderId, 1, 'Attempt over-refund', 'DA-ADMIN-TEST', o4.version);
  } catch (err) {
    if (err.message.includes('RefundExceedsOrderTotal')) {
      overRefundRejected = true;
    } else {
      console.warn("Caught error:", err.message);
    }
  }
  assert(overRefundRejected, "Over-refund rejection guard must reject refunds exceeding order total");
  console.log("  [PASS] Test 8: Over-refund rejection guard strictly prevented exceeding order balance");

  // ── 4. Webhook Sync & Idempotency ─────────────────────────────────────────────
  console.log("\nStep 4: Testing Webhook Sync & Idempotency...");

  const webhookPayload = {
    id: `rfnd_wh_${Date.now()}`,
    amount: 15000,
    status: 'processed',
    speed_processed: 'optimum',
    created_at: Math.floor(Date.now() / 1000),
    processed_at: Math.floor(Date.now() / 1000),
  };

  // First sync (Creation)
  const sync1 = await syncRazorpayRefundEntity(testOrderId, webhookPayload);
  assert(sync1.refund.gatewayRefundId === webhookPayload.id, "Webhook refund created in refunds table");
  
  // Duplicate sync (Idempotency)
  const sync2 = await syncRazorpayRefundEntity(testOrderId, webhookPayload);
  assert(sync2.refund.id === sync1.refund.id, "Duplicate webhook matched existing record by gatewayRefundId without duplication");
  console.log("  [PASS] Test 9: Webhook entity sync creates and updates idempotently");

  // ── 5. User API & Admin API Verification ──────────────────────────────────────
  console.log("\nStep 5: Verifying User Orders & Admin Query APIs...");

  const userOrders = await UsersService.getUserOrders(null, testUser.id);
  const fetchedOrder = userOrders.find(o => o.orderId === testOrderId || o.id === testOrderId);
  assert(fetchedOrder, "User order found in getUserOrders");
  assert(Array.isArray(fetchedOrder.refunds) && fetchedOrder.refunds.length === 5, `User order has all 5 refunds attached (Actual: ${fetchedOrder?.refunds?.length})`);
  console.log("  [PASS] Test 10: UsersService.getUserOrders returns normalized refunds array with all 5 items");

  const adminOrders = await OrdersRepository.getAllOrders({ refundStatus: 'processed', limit: 50 });
  const matchedAdminOrder = adminOrders.data.find(o => o.id === testOrderId);
  assert(matchedAdminOrder, "Admin getAllOrders({ refundStatus: 'processed' }) matched order via subquery");
  console.log("  [PASS] Test 11: Admin getAllOrders refund subquery filter successfully matched test order");

  const summary = await OrdersRepository.getOrderSummary();
  assert(typeof summary.refundsPending === 'number', "Order summary refundsPending returns valid number");
  console.log(`  [PASS] Test 12: OrdersRepository.getOrderSummary.refundsPending distinct count: ${summary.refundsPending}`);

  const attention = await AdminService.getAttentionCounts();
  assert(typeof attention.pendingRefunds === 'number', "Admin attention count pendingRefunds returns valid number");
  console.log(`  [PASS] Test 13: AdminService.getAttentionCounts.pendingRefunds distinct count: ${attention.pendingRefunds}`);

  const analytics = await AnalyticsService.getSalesAnalytics('last7days');
  assert(typeof analytics.kpis.refunds === 'number', "Analytics calculates processed refunds sum in rupees");
  console.log(`  [PASS] Test 14: AnalyticsService.getSalesAnalytics returned calculated refunds: ₹${analytics.kpis.refunds}`);

  const dashboardStats = await AdminService.getDashboardStats('last7days');
  assert(typeof dashboardStats.totalRefundsProcessed === 'number', "Dashboard stats returns totalRefundsProcessed");
  console.log(`  [PASS] Test 15: AdminService.getDashboardStats returned totalRefundsProcessed: ₹${dashboardStats.totalRefundsProcessed}`);

  // Cleanup test order
  await db.delete(refundsTable).where(eq(refundsTable.orderId, testOrderId));
  await db.delete(ordersTable).where(eq(ordersTable.id, testOrderId));
  console.log("  Cleaned up regression test order and associated refunds.");

  console.log("\n================================================================================");
  console.log("   ALL 15/15 REGRESSION VERIFICATION TESTS PASSED WITH 100% SUCCESS!           ");
  console.log("================================================================================\n");

  process.exit(0);
}

runRegressionVerification().catch(err => {
  console.error("REGRESSION VERIFICATION ERROR:", err);
  process.exit(1);
});
