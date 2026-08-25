// src/infrastructure/cache/cache.service.js
// Moved from: cacheMiddleware.js (root)
import { redis } from '../../config/redis.js';
import crypto from 'crypto';

const generateETag = (bodyString) =>
  `"${crypto.createHash('md5').update(bodyString).digest('hex')}"`;

/**
 * cache(keyOrFn, ttlSeconds, opts)
 * Express middleware — caches GET responses in Redis.
 */
export function cache(keyOrFn, ttlSeconds = 60, opts = {}) {
  const { onlyStatus = [200], enableEtag = true } = opts;

  return async (req, res, next) => {
    try {
      if (req.method !== 'GET') return next();

      if (
        req.headers['cache-control']?.includes('no-cache') ||
        req.query?.noCache === '1' ||
        req.query?.nocache === '1'
      ) {
        res.setHeader('X-Cache', 'BYPASS');
        return next();
      }

      const key = typeof keyOrFn === 'function' ? keyOrFn(req) : keyOrFn;
      if (!key || typeof key !== 'string' || !key.trim()) return next();

      if (redis.status === 'ready') {
        const cached = await redis.get(key);

        if (cached) {
          const parsed = JSON.parse(cached);

          if (enableEtag && parsed.etag && req.headers['if-none-match'] === parsed.etag) {
            res.setHeader('X-Cache', 'HIT');
            return res.status(304).end();
          }

          if (parsed.headers) {
            Object.entries(parsed.headers).forEach(([k, v]) => {
              if (k.toLowerCase() !== 'content-length') res.setHeader(k, v);
            });
          }

          if (enableEtag && parsed.etag) res.setHeader('ETag', parsed.etag);
          res.setHeader('X-Cache', 'HIT');
          return res.status(parsed.status || 200).json(parsed.body);
        }
      }

      const originalJson = res.json.bind(res);
      const originalSend = res.send.bind(res);
      res.setHeader('X-Cache', 'MISS');

      res.json = (body) => {
        try {
          const status = res.statusCode || 200;

          if (onlyStatus.includes(status) && redis.status === 'ready') {
            const headersToCache = {};
            ['content-type', 'cache-control'].forEach((h) => {
              const v = res.getHeader(h);
              if (v !== undefined) headersToCache[h] = String(v);
            });

            const bodyString = JSON.stringify(body);
            let etag = null;

            if (enableEtag) {
              etag = generateETag(bodyString);
              res.setHeader('ETag', etag);
            }

            redis
              .set(key, JSON.stringify({ status, headers: headersToCache, etag, body }), 'EX', ttlSeconds)
              .catch((e) => console.error(`[Cache] Set failed for ${key}:`, e.message));
          }
        } catch (err) {
          console.error('[Cache] Intercept error:', err.message);
        }
        return originalJson(body);
      };

      res.send = (body) => {
        if (typeof body === 'object' && body !== null && !Buffer.isBuffer(body)) {
          return res.json(body);
        }
        return originalSend(body);
      };

      next();
    } catch (err) {
      console.error('[Cache] Middleware error:', err.message);
      next();
    }
  };
}

/**
 * invalidateCache(key, prefix)
 * Non-blocking cache invalidation with optional prefix scan.
 */
export async function invalidateCache(key, prefix = false) {
  if (!key || redis.status !== 'ready') return;

  try {
    const unlinkFn =
      typeof redis.unlink === 'function' ? redis.unlink.bind(redis) : redis.del.bind(redis);

    if (!prefix) {
      await unlinkFn(key);
      console.log(`♻️ [Cache] Invalidated (single): ${key}`);
      return;
    }

    let cursor = '0';
    let totalDeleted = 0;

    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', `${key}*`, 'COUNT', 1000);
      cursor = nextCursor;

      if (keys.length > 0) {
        const pipeline = redis.pipeline();
        keys.forEach((k) => pipeline.unlink(k));
        await pipeline.exec();
        totalDeleted += keys.length;
      }
    } while (cursor !== '0');

    if (totalDeleted > 0) {
      console.log(`♻️ [Cache] Invalidated (prefix): ${key}* (${totalDeleted} keys)`);
    }
  } catch (err) {
    console.error('⚠️ [Cache] Invalidation failed:', err.message);
  }
}
