// src/workers/analytics.worker.js
// Analytics event processing worker stub.

import { queueClient } from '../infrastructure/queues/queue.client.js';
import { QUEUE_NAME } from '../infrastructure/queues/analytics.queue.js';

export const startAnalyticsWorker = () => {
  console.log(`🚜 Analytics Worker Started on '${QUEUE_NAME}'...`);
  processNextJob();
};

const processNextJob = async () => {
  try {
    const result = await queueClient.brpop(QUEUE_NAME, 5);
    if (result) {
      const job = JSON.parse(result[1]);
      // TODO: write to analytics store
    }
  } catch (err) {
    if (err.message && !err.message.includes('Connection is closed')) {
      console.error('⚠️ Analytics Worker Error:', err.message);
    }
  } finally {
    setTimeout(processNextJob, queueClient.status === 'ready' ? 0 : 2000);
  }
};
