// src/infrastructure/queues/analytics.queue.js
import { redis } from '../../config/redis.js';

const QUEUE_NAME = 'analytics_queue';

export const addToAnalyticsQueue = async (data) => {
  try {
    await redis.lpush(QUEUE_NAME, JSON.stringify(data));
  } catch (error) {
    console.error('❌ Failed to queue analytics event:', error);
  }
};

export { QUEUE_NAME };
