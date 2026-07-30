// middleware/rateLimiter.js
//
// 🟢 FIX (low-priority hardening item): "No rate limiting outside the
// contact form." The contact form's limiter is a per-process in-memory
// Map, which only works correctly on a single instance — on a
// horizontally scaled deployment each instance has its own map, so the
// real limit is effectively (configured limit × instance count).
//
// This is a Redis-backed fixed-window counter instead, since the app
// already depends on Redis (see configs/redis.js / cacheMiddleware.js)
// and Redis gives a single shared counter across every instance.
//
// It fails OPEN if Redis is unavailable — mirroring the circuit-breaker
// pattern already used in cacheMiddleware.js. A rate-limiter outage
// should degrade to "unlimited", never to "checkout is down".

import { redis } from '../configs/redis.js';

/**
 * rateLimit({ windowSeconds, max, keyPrefix, message })
 * - windowSeconds: length of the fixed window (default 60s)
 * - max: max requests allowed per identity per window (default 60)
 * - keyPrefix: namespaces the Redis key so different routes don't share buckets
 * - message: body returned on 429
 * - byUser: if true, key on the authenticated user (req.auth.userId) when
 *   present, falling back to IP for anonymous requests. Use this on routes
 *   mounted behind requireAuth. Leave false for public routes (coupon
 *   validate, contact form) where there's no reliable user identity yet.
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
      // 🛡️ Circuit Breaker: if Redis isn't connected, don't block traffic —
      // just skip rate limiting for this request.
      if (redis.status !== 'ready') return next();

      const identity =
        (byUser && req.auth?.userId) ||
        req.headers['x-forwarded-for']?.split(',')[0].trim() ||
        req.ip ||
        'unknown';

      const key = `${keyPrefix}:${identity}`;
      const count = await redis.incr(key);

      if (count === 1) {
        // First hit in this window — start the TTL clock.
        await redis.expire(key, windowSeconds);
      }

      res.setHeader('X-RateLimit-Limit', String(max));
      res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - count)));

      if (count > max) {
        return res.status(429).json({ success: false, error: message });
      }

      next();
    } catch (err) {
      console.error('[RateLimit] Middleware error:', err.message);
      next(); // Fail open — never let the limiter itself take down a route
    }
  };
}
