// src/middleware/rate-limit.js
// Moved from: middleware/rate-limit.js
// Redis-backed fixed-window rate limiter. Fails open if Redis is unavailable.

import { redis } from '../config/redis.js';

/**
 * rateLimit({ windowSeconds, max, keyPrefix, message, byUser })
 */
export function rateLimit({
  windowSeconds = 60,
  max = 60,
  keyPrefix = 'rl',
  message = 'Too many requests. Please slow down and try again shortly.',
  byUser = false,
} = {}) {
  return async (req, res, next) => {
    try {
      if (redis.status !== 'ready') return next();

      const identity =
        (byUser && req.auth?.userId) ||
        req.headers['x-forwarded-for']?.split(',')[0].trim() ||
        req.ip ||
        'unknown';

      const key = `${keyPrefix}:${identity}`;
      const count = await redis.incr(key);

      if (count === 1) await redis.expire(key, windowSeconds);

      res.setHeader('X-RateLimit-Limit', String(max));
      res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - count)));

      if (count > max) {
        return res.status(429).json({ success: false, error: message });
      }

      next();
    } catch (err) {
      console.error('[RateLimit] Middleware error:', err.message);
      next();
    }
  };
}
