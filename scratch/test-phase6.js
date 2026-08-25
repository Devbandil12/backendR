import { broadcastOrderEvent } from '../src/modules/orders/orders.sse.js';
import { getRedisConfig } from '../src/config/redis.js';
import Redis from 'ioredis';

async function runPhase6Tests() {
  console.log('🧪 Starting Phase 6 Real-Time SSE / Redis Events Test...\n');

  const config = getRedisConfig();
  const testSub = new Redis(config.url, config.options);
  const receivedEvents = [];

  await new Promise((resolve, reject) => {
    testSub.subscribe('orders_sse_events', (err) => {
      if (err) return reject(err);
      console.log('🔌 Test subscriber listening on orders_sse_events channel');
      resolve();
    });
  });

  testSub.on('message', (channel, msg) => {
    if (channel === 'orders_sse_events') {
      const parsed = JSON.parse(msg);
      receivedEvents.push(parsed);
      console.log(`📥 Received SSE Event via Redis: [${parsed.eventType}] -> target: ${parsed.target}`);
    }
  });

  // Small delay to ensure subscription is active
  await new Promise(r => setTimeout(r, 200));

  console.log('\n--- Broadcasting Test Events ---');
  
  // 1. ORDER_CREATED
  await broadcastOrderEvent('ORDER_CREATED', { orderId: 'DA-TEST-001', amount: 1499 });
  
  // 2. ORDER_STATUS_CHANGED
  await broadcastOrderEvent('ORDER_STATUS_CHANGED', { orderId: 'DA-TEST-001', status: 'Shipped' });
  
  // 3. PAYMENT_UPDATED
  await broadcastOrderEvent('PAYMENT_UPDATED', { orderId: 'DA-TEST-001', paymentStatus: 'paid' });
  
  // 4. SHIPMENT_UPDATED
  await broadcastOrderEvent('SHIPMENT_UPDATED', { orderId: 'DA-TEST-001', awb: '123456789' });
  
  // 5. RETURN_UPDATED
  await broadcastOrderEvent('RETURN_UPDATED', { orderId: 'DA-TEST-001', returnStatus: 'Requested' });
  
  // 6. REFUND_UPDATED
  await broadcastOrderEvent('REFUND_UPDATED', { orderId: 'DA-TEST-001', refundAmount: 1499 });

  // Wait for all messages to be delivered
  await new Promise(r => setTimeout(r, 600));

  console.log(`\n📊 Total events received: ${receivedEvents.length} / 6`);
  testSub.disconnect();

  if (receivedEvents.length >= 6) {
    console.log('🎉 Phase 6 Real-time Event Streaming tests passed completely!\n');
    process.exit(0);
  } else {
    console.error('❌ Some events were not received.');
    process.exit(1);
  }
}

runPhase6Tests().catch(err => {
  console.error('❌ Phase 6 test failed:', err);
  process.exit(1);
});
