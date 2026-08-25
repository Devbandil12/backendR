// src/infrastructure/cache/cache.lock.js
// Distributed lock helpers using Redis SET NX.
// Use to prevent duplicate processing in concurrent workers.

import { redis } from '../../config/redis.js';

/**
 * acquireLock(key, ttlSeconds)
 * Returns true if the lock was acquired, false if already held.
 */
export async function acquireLock(key, ttlSeconds = 30) {
  if (redis.status !== 'ready') return true; // Fail open
  const result = await redis.set(key, '1', 'EX', ttlSeconds, 'NX');
  return result === 'OK';
}

/**
 * releaseLock(key)
 */
export async function releaseLock(key) {
  if (redis.status !== 'ready') return;
  await redis.del(key);
}
