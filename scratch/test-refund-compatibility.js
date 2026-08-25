// scratch/test-refund-compatibility.js
// Verification suite for Unified Legacy-Compatible Refund Architecture

import { db } from '../src/db/client.js';
import { ordersTable, refundsTable, usersTable, UserAddressTable } from '../src/db/schema/index.js';
import { recordRefund, syncRazorpayRefundEntity } from '../src/modules/orders/refunds.compatibility.js';
import { insertAdminRefund, getOrderSummary } from '../src/modules/orders/orders.repository.js';
import { getAttentionCounts, getDashboardStats } from '../src/modules/admin/admin.service.js';
import { eq } from 'drizzle-orm';
import pkg from 'uuid';
const { v4: uuidv4 } = pkg;

async function runCompatibilityTests() {
  console.log('================================================================');
  console.log('🧪 TESTING REFUND COMPATIBILITY & DUAL-SYNCHRONIZATION LAYER');
  console.log('================================================================');

  let passed = 0;
  let failed = 0;

  function assert(condition, name, details = '') {
    if (condition) {
      console.log(`✅ PASS: ${name}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${name} — ${details}`);
      failed++;
    }
  }

  // Setup mock user & order
  const mockClerkId = `test_clerk_${Date.now()}`;
  const [testUser] = await db.insert(usersTable).values({
    clerkId: mockClerkId,
    name: 'Refund QA User',
    email: `refund_qa_${Date.now()}@example.com`,
    role: 'admin'
  }).returning();

  const [testAddress] = await db.insert(UserAddressTable).values({
    userId: testUser.id,
    name: 'Refund QA User',
    address: '123 Test St',
    city: 'Mumbai',
    state: 'Maharashtra',
    postalCode: '400001',
    phone: '9999999999'
  }).returning();

  const testOrderId = `TEST-REF-${Date.now().toString().slice(-6)}`;
  const [initialOrder] = await db.insert(ordersTable).values({
    id: testOrderId,
    userId: testUser.id,
    userAddressId: testAddress.id,
    totalAmount: 1999,
    paymentMode: 'online',
    paymentStatus: 'paid',
    phone: '9999999999',
    status: 'Processing',
    fulfillmentStatus: 'PROCESSING',
    transactionId: `pay_test_${Date.now()}`,
    version: 1
  }).returning();

  // --- TEST 1: Paise Amount & Lowercase Status Contract ---
  console.log('\n--- TEST 1: Paise Amount & Lowercase Status Contract ---');
  const r1GatewayId = `rfnd_test_${Date.now()}_1`;
  const refundPaise = 99900; // ₹999 in paise

  const { refund: r1, order: o1 } = await recordRefund({
    orderId: testOrderId,
    amount: refundPaise,
    refundStatus: 'in_progress', // lowercase legacy
    gatewayRefundId: r1GatewayId,
    refundSpeed: 'optimum',
    reason: 'Customer initiated cancellation'
  });

  assert(
    r1.amount === 99900 && r1.refundStatus === 'in_progress' && r1.gatewayRefundId === r1GatewayId,
    'New refunds row stores amount in paise (99900) and lowercase status (in_progress)',
    `amount=${r1.amount}, status=${r1.refundStatus}`
  );

  assert(
    o1.refund_amount === 99900 && o1.refund_status === 'in_progress' && o1.refund_id === r1GatewayId,
    'Legacy ordersTable fields synchronized: refund_amount=99900 (paise), refund_status=in_progress',
    `refund_amount=${o1.refund_amount}, refund_status=${o1.refund_status}`
  );

  // --- TEST 2: Razorpay Webhook Synchronization (Status Transition to 'processed') ---
  console.log('\n--- TEST 2: Razorpay Webhook & Status Update ---');
  const mockWebhookEntity = {
    id: r1GatewayId,
    amount: 99900,
    status: 'processed', // Razorpay webhook status
    speed_processed: 'optimum',
    created_at: Math.floor(Date.now() / 1000) - 300,
    processed_at: Math.floor(Date.now() / 1000)
  };

  const { refund: r2, order: o2 } = await syncRazorpayRefundEntity({
    orderId: testOrderId,
    entity: mockWebhookEntity
  });

  assert(
    r2.refundStatus === 'processed' && r2.completedAt !== null,
    'Webhook updates refundsTable to lowercase "processed" with completedAt timestamp',
    `status=${r2.refundStatus}, completedAt=${r2.completedAt}`
  );

  assert(
    o2.refund_status === 'processed' && o2.paymentStatus === 'partially_refunded' && o2.refund_completed_at !== null,
    'Webhook updates legacy ordersTable: refund_status="processed", paymentStatus="partially_refunded" (for ₹999 partial refund of ₹1999 order)',
    `refund_status=${o2.refund_status}, paymentStatus=${o2.paymentStatus}`
  );

  // --- TEST 3: Idempotency (Duplicate Webhook Does Not Create Duplicate Row) ---
  console.log('\n--- TEST 3: Idempotency Check ---');
  await syncRazorpayRefundEntity({
    orderId: testOrderId,
    entity: mockWebhookEntity
  });

  const allRefundsForOrder = await db.select().from(refundsTable).where(eq(refundsTable.orderId, testOrderId));
  assert(
    allRefundsForOrder.length === 1,
    'Repeated webhook for same gatewayRefundId updates existing row without duplicate insertions',
    `Total rows found: ${allRefundsForOrder.length}`
  );

  // --- TEST 4: Multi-Refund & Partial Refund Aggregation in Paise ---
  console.log('\n--- TEST 4: Multi-Refund & Aggregation ---');
  const r2GatewayId = `rfnd_test_${Date.now()}_2`;
  const partialPaise = 50000; // ₹500 in paise

  const { refund: r3, order: o3 } = await recordRefund({
    orderId: testOrderId,
    amount: partialPaise,
    refundStatus: 'processed',
    gatewayRefundId: r2GatewayId,
    reason: 'Partial customer compensation'
  });

  const allRefundsAfterSecond = await db.select().from(refundsTable).where(eq(refundsTable.orderId, testOrderId));
  const expectedTotalPaise = 99900 + 50000; // 149900 paise (₹1499)

  assert(
    allRefundsAfterSecond.length === 2 && o3.refund_amount === expectedTotalPaise,
    `Multi-refund creates second row and aggregates total paise in orders.refund_amount (${expectedTotalPaise} paise)`,
    `Row count=${allRefundsAfterSecond.length}, Total paise=${o3.refund_amount}`
  );

  // --- TEST 5: Admin Partial Refund via insertAdminRefund Repository ---
  console.log('\n--- TEST 5: Admin UI / Repository Partial Refund ---');
  const testOrder2Id = `TEST-REF-${Date.now().toString().slice(-6)}-2`;
  await db.insert(ordersTable).values({
    id: testOrder2Id,
    userId: testUser.id,
    userAddressId: testAddress.id,
    totalAmount: 2499,
    paymentMode: 'online',
    paymentStatus: 'paid',
    phone: '9999999999',
    status: 'Delivered',
    fulfillmentStatus: 'DELIVERED',
    version: 1
  });

  const adminRefund = await insertAdminRefund(testOrder2Id, 500, 'Fragrance cap damaged replacement', null, null, 1);
  const [order2AfterAdmin] = await db.select().from(ordersTable).where(eq(ordersTable.id, testOrder2Id));

  assert(
    adminRefund.amount === 50000 && adminRefund.refundStatus === 'processed',
    'insertAdminRefund converts rupee input (500) to paise (50000) with lowercase "processed" status',
    `amount=${adminRefund.amount}, status=${adminRefund.refundStatus}`
  );

  assert(
    order2AfterAdmin.refund_amount === 50000 && order2AfterAdmin.refund_status === 'processed' && order2AfterAdmin.version === 2,
    'ordersTable updated with refund_amount=50000, refund_status=processed, version=2',
    `refund_amount=${order2AfterAdmin.refund_amount}, refund_status=${order2AfterAdmin.refund_status}, version=${order2AfterAdmin.version}`
  );

  // --- TEST 6: Analytics & Query Safety with Lowercase Statuses ---
  console.log('\n--- TEST 6: Analytics & KPI Query Compatibility ---');
  const summary = await getOrderSummary();
  const attention = await getAttentionCounts();
  const stats = await getDashboardStats('all');

  assert(
    typeof summary.totalOrders === 'number' && typeof summary.refundsPending === 'number',
    'getOrderSummary successfully aggregates orders and refundsPending with lowercase status',
    `totalOrders=${summary.totalOrders}, refundsPending=${summary.refundsPending}`
  );

  assert(
    typeof attention.pendingRefunds === 'number' && typeof stats.totalRefundsProcessed === 'number',
    'getAttentionCounts & getDashboardStats aggregate without SQL errors',
    `pendingRefunds=${attention.pendingRefunds}, totalRefundsProcessed=₹${stats.totalRefundsProcessed}`
  );

  console.log('\n================================================================');
  console.log(`🏁 COMPATIBILITY TEST RESULTS: ${passed}/${passed + failed} PASSED (${failed} FAILED)`);
  console.log('================================================================');

  process.exit(failed > 0 ? 1 : 0);
}

runCompatibilityTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
