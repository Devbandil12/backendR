// src/observability/health.js
// Health check endpoint logic — import in app.js to expose /health.

import { db } from '../db/client.js';
import { redis } from '../config/redis.js';

export async function getHealthStatus() {
  const checks = {};

  // DB check
  try {
    await db.execute('SELECT 1');
    checks.database = 'ok';
  } catch {
    checks.database = 'error';
  }

  // Redis check
  checks.redis = redis.status === 'ready' ? 'ok' : 'error';

  const healthy = Object.values(checks).every((v) => v === 'ok');

  return { status: healthy ? 'ok' : 'degraded', checks, timestamp: new Date().toISOString() };
}
