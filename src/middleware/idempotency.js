// src/middleware/idempotency.js
// Idempotency key middleware — prevents duplicate POSTs from being processed twice.
// Store and return cached responses keyed by Idempotency-Key header.

import { redis } from '../config/redis.js';

const IDEMPOTENCY_TTL = 86400; // 24 hours

export const idempotency = async (req, res, next) => {
  if (!['POST', 'PUT', 'PATCH'].includes(req.method)) return next();

  const key = req.headers['idempotency-key'];
  if (!key) return next();

  const cacheKey = `idempotency:${key}`;

  try {
    if (redis.status === 'ready') {
      const cached = await redis.get(cacheKey);
      if (cached) {
        const { status, body } = JSON.parse(cached);
        res.setHeader('X-Idempotent-Replay', 'true');
        return res.status(status).json(body);
      }

      // Intercept the response to cache it
      const originalJson = res.json.bind(res);
      res.json = (body) => {
        const status = res.statusCode || 200;
        if (status >= 200 && status < 300) {
          redis
            .set(cacheKey, JSON.stringify({ status, body }), 'EX', IDEMPOTENCY_TTL)
            .catch(() => {});
        }
        return originalJson(body);
      };
    }
  } catch (err) {
    console.error('[Idempotency] Error:', err.message);
  }

  next();
};
