// scratch/test-partial-refund-lifecycle.js
// Verification of Partial vs Full Refund Payment Status Lifecycle

import { db } from '../src/db/client.js';
import { ordersTable, refundsTable, usersTable, UserAddressTable } from '../src/db/schema/index.js';
import { recordRefund, syncRazorpayRefundEntity } from '../src/modules/orders/refunds.compatibility.js';
import { eq } from 'drizzle-orm';

async function runPartialRefundTests() {
  console.log('================================================================');
  console.log('🧪 TESTING PARTIAL VS FULL REFUND PAYMENT STATUS LIFECYCLE');
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

  // Setup mock user & address
  const mockClerkId = `test_clerk_${Date.now()}`;
  const [testUser] = await db.insert(usersTable).values({
    clerkId: mockClerkId,
    name: 'Partial Refund QA User',
    email: `partial_qa_${Date.now()}@example.com`,
    role: 'admin'
  }).returning();

  const [testAddress] = await db.insert(UserAddressTable).values({
    userId: testUser.id,
    name: 'Partial Refund QA User',
    address: '456 Marine Drive',
    city: 'Mumbai',
    state: 'Maharashtra',
    postalCode: '400020',
    phone: '9888888888'
  }).returning();

  // Create Order: Total ₹2000 (200000 paise)
  const orderId = `TEST-MULTI-${Date.now().toString().slice(-6)}`;
  const [testOrder] = await db.insert(ordersTable).values({
    id: orderId,
    userId: testUser.id,
    userAddressId: testAddress.id,
    totalAmount: 2000,
    paymentMode: 'online',
    paymentStatus: 'paid',
    phone: '9888888888',
    status: 'Delivered',
    fulfillmentStatus: 'DELIVERED',
    transactionId: `pay_test_${Date.now()}`,
    version: 1
  }).returning();

  console.log(`\nCreated Test Order #${orderId} (Total: ₹2000, Initial paymentStatus: 'paid')`);

  // --- STEP 1: Process Partial Refund 1 (₹500 / 50000 paise) ---
  console.log('\n--- STEP 1: Process Partial Refund 1 (₹500 / 50,000 paise) ---');
  const { order: o1 } = await recordRefund({
    orderId,
    amount: 50000, // in paise
    refundStatus: 'processed',
    gatewayRefundId: `rfnd_part_1_${Date.now()}`,
    reason: 'Defective bottle cap compensation'
  });

  assert(
    o1.paymentStatus === 'partially_refunded' && o1.refund_amount === 50000,
    'Order paymentStatus becomes "partially_refunded" after partial refund of ₹500 (total: ₹2000)',
    `paymentStatus=${o1.paymentStatus}, refund_amount=${o1.refund_amount}`
  );

  // --- STEP 2: Process Partial Refund 2 (₹300 / 30000 paise) ---
  console.log('\n--- STEP 2: Process Partial Refund 2 (₹300 / 30,000 paise) ---');
  const { order: o2 } = await recordRefund({
    orderId,
    amount: 30000, // in paise
    refundStatus: 'processed',
    gatewayRefundId: `rfnd_part_2_${Date.now()}`,
    reason: 'Shipping delay goodwill token'
  });

  assert(
    o2.paymentStatus === 'partially_refunded' && o2.refund_amount === 80000,
    'Order paymentStatus REMAINS "partially_refunded" after second partial refund of ₹300 (total refunded: ₹800)',
    `paymentStatus=${o2.paymentStatus}, refund_amount=${o2.refund_amount}`
  );

  // --- STEP 3: Process Final Refund of Remaining Amount (₹1200 / 120000 paise) ---
  console.log('\n--- STEP 3: Process Final Refund of Remaining Amount (₹1200 / 120,000 paise) ---');
  const { order: o3 } = await recordRefund({
    orderId,
    amount: 120000, // in paise
    refundStatus: 'processed',
    gatewayRefundId: `rfnd_part_3_${Date.now()}`,
    reason: 'Full return settlement'
  });

  assert(
    o3.paymentStatus === 'refunded' && o3.refund_amount === 200000,
    'Order paymentStatus transitions to "refunded" when total refunded reaches full order total (₹2000)',
    `paymentStatus=${o3.paymentStatus}, refund_amount=${o3.refund_amount}`
  );

  // --- STEP 4: In-Progress / Pending Refund on Fresh Order ---
  console.log('\n--- STEP 4: In-Progress / Pending Refund on Fresh Order ---');
  const pendingOrderId = `TEST-PEND-${Date.now().toString().slice(-6)}`;
  await db.insert(ordersTable).values({
    id: pendingOrderId,
    userId: testUser.id,
    userAddressId: testAddress.id,
    totalAmount: 1500,
    paymentMode: 'online',
    paymentStatus: 'paid',
    phone: '9888888888',
    status: 'Processing',
    fulfillmentStatus: 'PROCESSING',
    transactionId: `pay_test_${Date.now()}`,
    version: 1
  });

  const { order: oPending } = await recordRefund({
    orderId: pendingOrderId,
    amount: 50000, // in paise
    refundStatus: 'in_progress',
    gatewayRefundId: `rfnd_pend_${Date.now()}`,
    reason: 'Customer cancellation in progress'
  });

  assert(
    oPending.paymentStatus === 'paid' && oPending.refund_status === 'in_progress',
    'Order paymentStatus remains "paid" while refund is "in_progress" (not yet processed)',
    `paymentStatus=${oPending.paymentStatus}, refund_status=${oPending.refund_status}`
  );

  console.log('\n================================================================');
  console.log(`🏁 PARTIAL REFUND LIFECYCLE RESULTS: ${passed}/${passed + failed} PASSED (${failed} FAILED)`);
  console.log('================================================================');

  process.exit(failed > 0 ? 1 : 0);
}

runPartialRefundTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
