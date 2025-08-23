import { redis } from "../src/configs/redis.js";

/**
 * Cache middleware for GET requests
 * @param {string|function} keyOrFn - cache key or function(req) => key
 * @param {number} ttl - expiration in seconds
 */
export function cache(keyOrFn, ttl = 60) {
  return async (req, res, next) => {
    try {
      if (req.method !== "GET") return next();

      const key = typeof keyOrFn === "function" ? keyOrFn(req) : keyOrFn;
      const cached = await redis.get(key);

      if (cached) {
        console.log(`✅ Cache hit: ${key}`);
        return res.json(JSON.parse(cached));
      }

      // Wrap res.json to cache fresh data
      const originalJson = res.json.bind(res);
      res.json = (data) => {
        redis.set(key, JSON.stringify(data), "EX", ttl).catch(console.error);
        return originalJson(data);
      };

      next();
    } catch (err) {
      console.error("⚠️ Cache middleware error:", err.message);
      next();
    }
  };
}

/**
 * Invalidate cache by exact key or prefix
 * If prefix = true, deletes all matching keys
 */
export async function invalidateCache(key, prefix = false) {
  try {
    if (prefix) {
      const keys = await redis.keys(`${key}*`);
      if (keys.length > 0) {
        const pipeline = redis.pipeline();
        keys.forEach((k) => pipeline.del(k));
        await pipeline.exec();
        console.log(`♻️ Cache invalidated (prefix): ${key}`);
      }
    } else {
      await redis.del(key);
      console.log(`♻️ Cache invalidated (single): ${key}`);
    }
  } catch (err) {
    console.error("⚠️ Failed to invalidate cache:", err.message);
  }
}
