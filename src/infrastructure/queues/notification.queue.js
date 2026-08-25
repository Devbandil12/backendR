// src/infrastructure/queues/notification.queue.js
import { redis } from '../../config/redis.js';

const QUEUE_NAME = 'notification_queue';

export const addToNotificationQueue = async (data) => {
  try {
    await redis.lpush(QUEUE_NAME, JSON.stringify(data));
    console.log(`✅ Notification job queued`);
  } catch (error) {
    console.error('❌ Failed to queue notification:', error);
  }
};

export { QUEUE_NAME };
