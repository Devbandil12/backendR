import { db } from '../db/client.js';
import { sql, eq } from 'drizzle-orm';
import { ordersTable, orderItemsTable } from '../db/schema/orders.schema.js';
import { usersTable, UserAddressTable } from '../db/schema/users.schema.js';
import { refundsTable } from '../db/schema/returns.schema.js';
import * as OrdersRepository from '../modules/orders/orders.repository.js';
import assert from 'assert';

async function testPartialRefundWorkflow() {
  console.log("================================================================================");
  console.log("   TESTING ENHANCED PARTIAL REFUND WORKFLOW IN ORDERS COMMAND CENTER            ");
  console.log("================================================================================\n");

  // 1. Setup test user & address
  const [testAddress] = await db.select().from(UserAddressTable).limit(1);
  const [testUser] = await db.select().from(usersTable).where(eq(usersTable.id, testAddress.userId)).limit(1);

  const testOrderId = `DA_PARTIAL_TEST_${Date.now()}`;
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

  console.log(`Created test order: ${testOrderId} (₹2,000)`);

  // 2. Stage 1: Refund ₹500
  console.log("\nStage 1: Processing Partial Refund ₹500 (Item returned)...");
  const ref1 = await OrdersRepository.insertAdminRefund(
    testOrderId,
    500,
    'Item returned: Size does not fit'
  );
  assert(Number(ref1.amount) === 50000, `Refund 1 stored as 50,000 paise (Actual: ${ref1.amount})`);
  assert(ref1.reason === 'Item returned: Size does not fit', `Reason persisted correctly: ${ref1.reason}`);

  const [orderAfterRef1] = await db.select().from(ordersTable).where(eq(ordersTable.id, testOrderId));
  assert(orderAfterRef1.paymentStatus === 'partially_refunded', `Payment status is partially_refunded (Actual: ${orderAfterRef1.paymentStatus})`);
  console.log("  [PASS] Test 1: Refund 1 (₹500 / ₹2000) -> 50,000 paise, paymentStatus 'partially_refunded'");

  // 3. Stage 2: Refund ₹300 (Goodwill adjustment)
  console.log("\nStage 2: Processing Partial Refund ₹300 (Goodwill adjustment)...");
  const ref2 = await OrdersRepository.insertAdminRefund(
    testOrderId,
    300,
    'Goodwill adjustment: Customer compensation for delivery delay'
  );
  assert(Number(ref2.amount) === 30000, `Refund 2 stored as 30,000 paise (Actual: ${ref2.amount})`);

  const [orderAfterRef2] = await db.select().from(ordersTable).where(eq(ordersTable.id, testOrderId));
  assert(orderAfterRef2.paymentStatus === 'partially_refunded', `Payment status remains partially_refunded (Actual: ${orderAfterRef2.paymentStatus})`);
  console.log("  [PASS] Test 2: Refund 2 (₹300, cum. ₹800) -> 30,000 paise, paymentStatus 'partially_refunded'");

  // 4. Over-Refund Attempt: Try refunding ₹1,201 when remaining is ₹1,200
  console.log("\nStage 3: Attempting Over-Refund (₹1,201 when remaining is ₹1,200)...");
  let overRefundRejected = false;
  try {
    await OrdersRepository.insertAdminRefund(testOrderId, 1201, 'Invalid over-refund attempt');
  } catch (err) {
    if (err.message.includes('RefundExceedsOrderTotal')) {
      overRefundRejected = true;
      console.log(`  Expected error caught: ${err.message}`);
    }
  }
  assert(overRefundRejected, "Must reject refund request exceeding remaining balance");
  console.log("  [PASS] Test 3: Over-refund attempt of ₹1,201 strictly rejected by backend");

  // 5. Zero / Negative Refund Rejection
  console.log("\nStage 4: Attempting ₹0 and Negative Refunds...");
  let zeroRejected = false;
  try {
    await OrdersRepository.insertAdminRefund(testOrderId, 0, 'Zero refund');
  } catch (err) {
    if (err.message.includes('RefundAmountInvalid')) zeroRejected = true;
  }
  assert(zeroRejected, "Must reject ₹0 refund");
  console.log("  [PASS] Test 4: ₹0 refund rejected");

  let negativeRejected = false;
  try {
    await OrdersRepository.insertAdminRefund(testOrderId, -50, 'Negative refund');
  } catch (err) {
    if (err.message.includes('RefundAmountInvalid')) negativeRejected = true;
  }
  assert(negativeRejected, "Must reject negative refund");
  console.log("  [PASS] Test 5: Negative refund rejected");

  // 6. Stage 5: Final Refund of ₹1,200 to complete full refund
  console.log("\nStage 5: Processing Final Refund ₹1,200 to complete full order refund...");
  const ref3 = await OrdersRepository.insertAdminRefund(
    testOrderId,
    1200,
    'Damaged product: Bottle broken during transit'
  );
  assert(Number(ref3.amount) === 120000, `Refund 3 stored as 120,000 paise (Actual: ${ref3.amount})`);

  const [orderAfterRef3] = await db.select().from(ordersTable).where(eq(ordersTable.id, testOrderId));
  assert(orderAfterRef3.paymentStatus === 'refunded', `Payment status is refunded (Actual: ${orderAfterRef3.paymentStatus})`);
  console.log("  [PASS] Test 6: Final Refund (₹1200, cum. ₹2000) -> 120,000 paise, paymentStatus 'refunded'");

  // 7. Post-Full-Refund Attempt: Try refunding ₹1 after 100% refunded
  console.log("\nStage 6: Attempting Refund after 100% full refund...");
  let postFullRejected = false;
  try {
    await OrdersRepository.insertAdminRefund(testOrderId, 1, 'Attempt refund after full');
  } catch (err) {
    if (err.message.includes('RefundExceedsOrderTotal')) {
      postFullRejected = true;
    }
  }
  assert(postFullRejected, "Must reject refund when order is already fully refunded");
  console.log("  [PASS] Test 7: Refund after 100% full refund strictly rejected");

  // 8. Verify Order Details API with financialSummary
  console.log("\nStage 7: Verifying Order Details API with financialSummary...");
  const orderDetails = await OrdersRepository.getOrderByIdWithDetails(testOrderId);
  assert(orderDetails.refunds.length === 3, `Order has 3 refunds recorded (Actual: ${orderDetails.refunds.length})`);
  console.log(`  [PASS] Test 8: Order has all 3 refunds in history`);

  // Cleanup
  await db.delete(refundsTable).where(eq(refundsTable.orderId, testOrderId));
  await db.delete(ordersTable).where(eq(ordersTable.id, testOrderId));
  console.log("  Cleaned up test order.");

  console.log("\n================================================================================");
  console.log("   ALL 8/8 ENHANCED PARTIAL REFUND TESTS PASSED WITH 100% SUCCESS!             ");
  console.log("================================================================================\n");

  process.exit(0);
}

testPartialRefundWorkflow().catch(err => {
  console.error("TEST ERROR:", err);
  process.exit(1);
});
