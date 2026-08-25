// src/server.js
// HTTP server entry point.
// Bootstraps: Express app, HTTP server, cron scheduler, workers.

import 'dotenv/config';
import http from 'http';
import app from './app.js';
import { initScheduler } from './jobs/scheduler.js';
import { startEmailWorker } from './workers/email.worker.js';
import './workers/support-email.worker.js';
import './workers/outbox.processor.js';
import { startSiteScheduler, stopSiteScheduler } from './modules/site/site.scheduler.js';

const PORT = process.env.PORT || 3000;

const server = http.createServer(app);

// ── Start cron jobs ───────────────────────────────────────────────────────────
initScheduler();
startSiteScheduler();

// ── Start queue workers ───────────────────────────────────────────────────────
startEmailWorker();

// ── Listen ───────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

// Graceful shutdown
const shutdown = (signal) => {
  console.log(`\n${signal} received — shutting down gracefully.`);
  stopSiteScheduler();
  server.close(() => {
    console.log('✅ HTTP server closed.');
    process.exit(0);
  });

  // Force kill after 10s
  setTimeout(() => {
    console.error('⚠️ Forcing shutdown after timeout.');
    process.exit(1);
  }, 10_000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
 
 
 
 
 
 
 
