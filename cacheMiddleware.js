import { redis } from "../configs/redis.js";

/**
 * Cache middleware for GET requests
 * @param {string} prefix - cache key prefix (e.g. "products")
 * @param {number} ttl - cache expiration in seconds
 */
export function cache(prefix, ttl = 60) {
  return async (req, res, next) => {
    try {
      // Skip cache for non-GET requests
      if (req.method !== "GET") return next();

      // Build unique key (prefix + URL)
      const key = `${prefix}:${req.originalUrl}`;
      const cached = await redis.get(key);

      if (cached) {
        console.log(`✅ Cache hit: ${key}`);
        return res.json(JSON.parse(cached));
      }

      // Wrap res.json to store response in cache
      const originalJson = res.json.bind(res);
      res.json = (data) => {
        redis.set(key, JSON.stringify(data), "EX", ttl).catch(console.error);
        return originalJson(data);
      };

      next();
    } catch (err) {
      console.error("⚠️ Cache middleware error:", err.message);
      next(); // fallback
    }
  };
}

/**
 * Invalidate cache for a given prefix
 * Use this after POST/PUT/DELETE to avoid stale data
 * @param {string} prefix - cache key prefix
 */
export async function invalidateCache(prefix) {
  try {
    const keys = await redis.keys(`${prefix}:*`);
    if (keys.length > 0) {
      await redis.del(keys);
      console.log(`♻️ Cache invalidated for prefix: ${prefix}`);
    }
  } catch (err) {
    console.error("⚠️ Failed to invalidate cache:", err.message);
  }
}
