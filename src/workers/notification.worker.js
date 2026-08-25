// src/workers/notification.worker.js
// Stub — implement push/web notification processing here.

import { queueClient } from '../infrastructure/queues/queue.client.js';
import { QUEUE_NAME } from '../infrastructure/queues/notification.queue.js';

export const startNotificationWorker = () => {
  console.log(`🚜 Notification Worker Started on '${QUEUE_NAME}'...`);
  processNextJob();
};

const processNextJob = async () => {
  try {
    const result = await queueClient.brpop(QUEUE_NAME, 5);
    if (result) {
      const job = JSON.parse(result[1]);
      console.log('📬 Notification job received:', job);
      // TODO: process notification
    }
  } catch (err) {
    if (err.message && !err.message.includes('Connection is closed')) {
      console.error('⚠️ Notification Worker Error:', err.message);
    }
  } finally {
    setTimeout(processNextJob, queueClient.status === 'ready' ? 0 : 2000);
  }
};
