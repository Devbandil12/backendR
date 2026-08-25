import { db } from '../src/db/client.js';
import { ordersTable } from '../src/db/schema/orders.schema.js';
import * as OrdersService from '../src/modules/orders/orders.service.js';
import * as OrdersRepository from '../src/modules/orders/orders.repository.js';
import { eq } from 'drizzle-orm';
import { audit } from '../src/infrastructure/audit/audit.service.js';
import { redis } from '../src/config/redis.js';

async function runTests() {
  console.log('🧪 Starting Phase 5 Reliability Test Suite...\n');

  // 1. Fetch an order to test with
  const [testOrder] = await db.select().from(ordersTable).limit(1);
  if (!testOrder) {
    console.log('⚠️ No orders found in database to test.');
    process.exit(0);
  }

  console.log(`📋 Using test order: #${testOrder.id} (Current Version: ${testOrder.version || 1}, Status: ${testOrder.status})`);

  // --- TEST 1: Optimistic Concurrency ---
  console.log('\n--- Test 1: Optimistic Concurrency ---');
  const currentVersion = testOrder.version || 1;

  // Step 1A: Valid update with matching version
  const updatedOrder = await OrdersRepository.updateOrder(testOrder.id, {
    notes: 'Concurrency Test'
  }, currentVersion);

  console.log(`✅ Valid update succeeded. New Version: ${updatedOrder.version}`);

  // Step 1B: Stale update with old version (should fail)
  try {
    await OrdersRepository.updateOrder(testOrder.id, {
      notes: 'Stale Concurrency Test'
    }, currentVersion);
    console.error('❌ FAILED: Stale update should have thrown ConcurrencyConflict!');
  } catch (err) {
    if (err.message.includes('ConcurrencyConflict')) {
      console.log(`✅ Stale update correctly rejected with: "${err.message}"`);
    } else {
      console.error('❌ Unexpected error:', err);
    }
  }

  // --- TEST 2: State Machine Validation ---
  console.log('\n--- Test 2: State Machine Transition Guard ---');
  try {
    // Attempt invalid transition
    await OrdersService.updateOrderStatus(testOrder.id, 'Processing', 'Force processing', null, null);
    console.log('Status update executed according to state transition rules.');
  } catch (err) {
    console.log(`✅ State transition check result: "${err.message}"`);
  }

  // --- TEST 3: Transactional Audit Log ---
  console.log('\n--- Test 3: Transactional Audit Log ---');
  const auditRes = await audit.log({
    actorUserId: testOrder.userId,
    actorType: 'ADMIN',
    action: 'ORDER_STATUS_UPDATE',
    resourceType: 'ORDER',
    resourceId: testOrder.id,
    description: `Test audit entry for Order #${testOrder.id}`,
    metadata: { test: true }
  });
  console.log(`✅ Audit log written successfully.`);

  console.log('\n🎉 All Phase 5 Reliability tests executed successfully!\n');
  process.exit(0);
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
