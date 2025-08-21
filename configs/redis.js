// configs/redis.js
import Redis from "ioredis";

export const redis = new Redis(process.env.REDIS_URL, {
  tls: {}, // Upstash requires secure (rediss://)
});
