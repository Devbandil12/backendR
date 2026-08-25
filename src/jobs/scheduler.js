// src/jobs/scheduler.js
// Central cron scheduler — replaces initCronJobs() in jobs/cron.service.js.
// Import and call initScheduler() from src/server.js.

import cron from 'node-cron';
import { runAbandonedCartJob } from './cron/abandoned-cart.job.js';
import { runOrderCleanupJob } from './cron/order-cleanup.job.js';
// import { runNotificationJob } from './cron/notification.job.js';

export const initScheduler = () => {
  console.log('⏰ Initializing Cron Scheduler...');

  // Abandoned cart recovery — Runs at 10:00 AM on the 1st and 15th of every month
  cron.schedule('0 10 1,15 * *', runAbandonedCartJob);

  // Order cleanup / Shiprocket booking — every 5 minutes
  cron.schedule('*/5 * * * *', runOrderCleanupJob);

  // Notification sweep — daily at 9 AM (stub)
  // cron.schedule('0 9 * * *', runNotificationJob);

  console.log('✅ Cron Scheduler Initialized.');
};
