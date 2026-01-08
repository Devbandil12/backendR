// configs/redis.js
import Redis from "ioredis";
import 'dotenv/config'; 

const redisUrl = process.env.REDIS_URL;

if (!redisUrl) {
  throw new Error("❌ REDIS_URL is missing in .env");
}

export const getRedisConfig = () => {
    const isSecure = redisUrl.startsWith("rediss://");
    return {
        url: redisUrl,
        options: {
            tls: isSecure ? { rejectUnauthorized: false } : undefined,
            // ❌ REMOVED: maxRetriesPerRequest: null (Keep default for caching safety)
        }
    };
};

const config = getRedisConfig();
export const redis = new Redis(config.url, config.options);

redis.on("connect", () => console.log("🔌 Shared Redis: Connected"));
redis.on("error", (err) => console.error("❌ Shared Redis Error:", err.message));