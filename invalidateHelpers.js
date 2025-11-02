// invalidateHelpers.js
import { invalidateCache } from "./cacheMiddleware.js";

/**
 * items: [{ key: string, prefix?: boolean }]
 */
export async function invalidateMultiple(items = []) {
  if (!Array.isArray(items) || items.length === 0) return;
  const jobs = items.map((it) => invalidateCache(it.key, !!it.prefix));
  await Promise.all(jobs);
}
