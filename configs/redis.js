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
            // 👇 ADD THIS: Keep the connection alive
            keepAlive: 10000, // Ping every 10 seconds
            family: 4,        // Force IPv4 (Good for Render reliability)
        }
    };
};

const config = getRedisConfig();
export const redis = new Redis(config.url, config.options);

redis.on("connect", () => console.log("🔌 Shared Redis: Connected"));
redis.on("error", (err) => console.error("❌ Shared Redis Error:", err.message));