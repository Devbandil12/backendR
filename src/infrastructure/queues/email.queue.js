// src/infrastructure/queues/email.queue.js
// Moved from: infrastructure/queues/email.queue.js
// Publisher side only — adds jobs to the Redis list.
// The consumer (worker) lives in src/workers/email.worker.js.

import { redis } from '../../config/redis.js';

const QUEUE_NAME = process.env.QUEUE_NAME || 'email_queue_v2';

export const addToEmailQueue = async (data) => {
  try {
    await redis.lpush(QUEUE_NAME, JSON.stringify(data));
    console.log(`✅ Email job added to ${QUEUE_NAME}`);
  } catch (error) {
    console.error('❌ Failed to queue email:', error);
  }
};

export { QUEUE_NAME };
