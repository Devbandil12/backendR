// cacheMiddleware.js
import { redis } from "./configs/redis.js";

/**
 * cache(keyOrFn, ttlSeconds, opts)
 * - keyOrFn: string or function(req) => string
 * - ttlSeconds: number
 * - opts.onlyStatus: array of statuses to cache (default [200])
 */
export function cache(keyOrFn, ttlSeconds = 60, opts = {}) {
  const onlyStatus = opts.onlyStatus ?? [200];

  return async (req, res, next) => {
    try {
      // Only cache GET requests
      if (req.method !== "GET") return next();

      // Bypass if client asked not to cache
      if (
        req.headers["cache-control"]?.includes("no-cache") ||
        req.query?.noCache === "1" ||
        req.query?.nocache === "1"
      ) {
        return next();
      }

      // Compute key
      const key = typeof keyOrFn === "function" ? keyOrFn(req) : keyOrFn;
      if (!key || typeof key !== "string" || key.trim() === "") {
        console.warn("Cache middleware: empty key — skipping cache");
        return next();
      }

      // Try read from cache
      const cached = await redis.get(key);
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          // restore headers
          if (parsed.headers) {
            Object.entries(parsed.headers).forEach(([k, v]) => {
              // don't override content-length
              if (k.toLowerCase() !== "content-length") res.setHeader(k, v);
            });
          }
          res.status(parsed.status || 200).json(parsed.body);
          console.log(`✅ Cache hit: ${key}`);
          return;
        } catch (err) {
          console.warn("Cache parse error — proceeding to origin:", err.message);
          // fallthrough to origin
        }
      }

      // Wrap res.json (and res.send for safety) to cache result after origin responds
      const originalJson = res.json.bind(res);
      const originalSend = res.send.bind(res);

      let didRespond = false;

      res.json = (body) => {
        didRespond = true;
        try {
          const status = res.statusCode || 200;
          if (onlyStatus.includes(status)) {
            // gather headers we want to persist
            const headersToCache = {};
            ["content-type", "cache-control"].forEach((h) => {
              const v = res.getHeader(h);
              if (v !== undefined) headersToCache[h] = String(v);
            });

            // compose payload
            const payload = {
              status,
              headers: headersToCache,
              body,
            };

            // safe stringify
            let str;
            try {
              str = JSON.stringify(payload);
            } catch (err) {
              console.warn("Cache skip stringify failed:", err.message);
              str = null;
            }

            if (str) {
              // set but don't await (fire-and-forget)
              redis.set(key, str, "EX", ttlSeconds).catch((e) =>
                console.error("Cache set failed:", e && e.message ? e.message : e)
              );
            }
          }
        } catch (err) {
          console.error("Cache error while storing:", err.message);
        }
        return originalJson(body);
      };

      // For non-object sends, route through res.json when possible
      res.send = (body) => {
        if (typeof body === "object" && body !== null) {
          return res.json(body);
        }
        return originalSend(body);
      };

      next();
    } catch (err) {
      console.error("Cache middleware unexpected error:", err && err.message ? err.message : err);
      next();
    }
  };
}

/**
 * invalidateCache(key, prefix = false)
 * - if prefix === true: deletes keys that start with `key` using scanStream (safe).
 * - otherwise deletes exact key.
 */
export async function invalidateCache(key, prefix = false) {
  try {
    if (!key) return;

    if (!prefix) {
      // ioredis supports UNLINK; if not available, DEL is fine
      if (typeof redis.unlink === "function") {
        await redis.unlink(key);
      } else {
        await redis.del(key);
      }
      console.log(`♻️ Cache invalidated (single): ${key}`);
      return;
    }

    // prefix invalidation — use scanStream to avoid blocking Redis
    const pattern = `${key}*`;
    const keysToDelete = [];

    await new Promise((resolve, reject) => {
      const stream = redis.scanStream({ match: pattern, count: 1000 });
      stream.on("data", (resultKeys = []) => {
        for (const k of resultKeys) keysToDelete.push(k);
      });
      stream.on("end", resolve);
      stream.on("error", reject);
    });

    if (keysToDelete.length === 0) {
      console.log(`♻️ Cache invalidation (prefix): no keys for prefix ${key}`);
      return;
    }

    // delete in chunks using pipeline
    const pipeline = redis.pipeline();
    const CHUNK = 500;
    for (let i = 0; i < keysToDelete.length; i += CHUNK) {
      const slice = keysToDelete.slice(i, i + CHUNK);
      slice.forEach((k) => pipeline.del(k));
      // exec per chunk to keep pipeline size bounded
      await pipeline.exec();
    }
    console.log(`♻️ Cache invalidated (prefix): ${key} -> ${keysToDelete.length} keys`);
  } catch (err) {
    console.error("⚠️ Failed to invalidate cache:", err && err.message ? err.message : err);
  }
}
