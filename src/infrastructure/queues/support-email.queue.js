import { Queue } from 'bullmq';
import { getRedisConfig } from '../../config/redis.js';
import Redis from 'ioredis';

const config = getRedisConfig();

// BullMQ needs its own Redis connection
const connection = new Redis(config.url, {
  ...config.options,
  maxRetriesPerRequest: null, // Required by BullMQ
});

export const supportEmailQueue = new Queue('support-email-queue', {
  connection,
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: true,
    removeOnFail: 100,
  },
});

console.log('✅ BullMQ: support-email-queue initialized');
