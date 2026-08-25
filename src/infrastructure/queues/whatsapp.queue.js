// src/infrastructure/queues/whatsapp.queue.js
import { redis } from '../../config/redis.js';

const QUEUE_NAME = 'whatsapp_queue';

export const addToWhatsappQueue = async (data) => {
  try {
    await redis.lpush(QUEUE_NAME, JSON.stringify(data));
    console.log(`✅ WhatsApp job queued`);
  } catch (error) {
    console.error('❌ Failed to queue WhatsApp message:', error);
  }
};

export { QUEUE_NAME };
