// src/config/redis.js
import Redis from 'ioredis';
import 'dotenv/config';

const redisUrl = process.env.REDIS_URL;

if (!redisUrl) {
  throw new Error('❌ REDIS_URL is missing in .env');
}

export const getRedisConfig = () => {
  const isSecure = redisUrl.startsWith('rediss://');
  return {
    url: redisUrl,
    options: {
      tls: isSecure ? { rejectUnauthorized: false } : undefined,
      keepAlive: 10000, // Ping every 10 seconds
      family: 4,        // Force IPv4 (Good for Render reliability)

      // How many times ioredis retries a SINGLE command while the connection
      // is down/reconnecting before giving up and rejecting the command's
      // promise. Default is 20 — with fast, frequent reconnects (as seen in
      // this app's logs) that can leave a command "hanging" for many seconds
      // before it finally fails, which is what was stalling requests.
      // Kept low here so any redis call that ISN'T explicitly guarded still
      // fails fast instead of hanging the request. Dedicated blocking
      // connections (BullMQ workers, BRPOP loops) override this back to
      // `null`, which is required for them.
      maxRetriesPerRequest: 3,

      // Exponential backoff between reconnect attempts, capped at 3s, instead
      // of ioredis hammering the connection immediately on every drop.
      retryStrategy: (times) => Math.min(times * 200, 3000),

      // Force a full reconnect (rather than silently erroring) on the
      // specific errors seen in production — READONLY (failover) and
      // ECONNRESET (the network resets observed in the logs).
      reconnectOnError: (err) => {
        const targetErrors = ['READONLY', 'ECONNRESET', 'ETIMEDOUT'];
        return targetErrors.some((e) => err.message.includes(e));
      },
    },
  };
};

const config = getRedisConfig();
export const redis = new Redis(config.url, config.options);

redis.on('connect', () => console.log('🔌 Shared Redis: Connected'));
redis.on('error', (err) => console.error('❌ Shared Redis Error:', err.message));
redis.on('reconnecting', (delay) => console.warn(`🔄 Shared Redis: Reconnecting in ${delay}ms...`));