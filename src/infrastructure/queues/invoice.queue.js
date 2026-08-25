// src/infrastructure/queues/invoice.queue.js
import { redis } from '../../config/redis.js';

const QUEUE_NAME = 'invoice_queue';

export const addToInvoiceQueue = async (data) => {
  try {
    await redis.lpush(QUEUE_NAME, JSON.stringify(data));
    console.log(`✅ Invoice job queued`);
  } catch (error) {
    console.error('❌ Failed to queue invoice:', error);
  }
};

export { QUEUE_NAME };
