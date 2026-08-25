// src/infrastructure/queues/queue.client.js
// Shared Redis client for queue workers — dedicated connection with maxRetriesPerRequest: null
// (required by BullMQ / brpop-style blocking operations).

import Redis from 'ioredis';
import { getRedisConfig } from '../../config/redis.js';

const config = getRedisConfig();

export const queueClient = new Redis(config.url, {
  ...config.options,
  maxRetriesPerRequest: null,
});

queueClient.once('connect', () => console.log('👷 Queue Client: Connected to Redis'));
queueClient.on('reconnecting', () => console.warn('🔄 Queue Client: Reconnecting to Redis...'));
queueClient.on('error', (err) => console.error('❌ Queue Client Error:', err.message));
