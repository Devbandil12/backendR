import { getSiteStatus, updateSiteStatus } from './site.service.js';
import { redis } from '../../config/redis.js';

let intervalId = null;

// The backend worker running to monitor site state
export function startSiteScheduler() {
  console.log('⏰ [SiteScheduler] Starting Site Status monitor...');
  
  // Run every 3 seconds to check if we should transition states
  intervalId = setInterval(async () => {
    try {
      const lockKey = 'lock:cron:site-scheduler';
      const acquired = await redis.set(lockKey, 'locked', 'EX', 3, 'NX');
      if (!acquired) return; // Another node is doing it

      const status = await getSiteStatus();
      const now = new Date();

      if (status.mode === 'LIVE' && status.scheduledStart) {
        if (new Date(status.scheduledStart) <= now && (!status.scheduledEnd || new Date(status.scheduledEnd) > now)) {
          // Transition to MAINTENANCE
          console.log('⚠️ [SiteScheduler] Scheduled maintenance starting! Transitioning to MAINTENANCE...');
          await transitionTo('MAINTENANCE', 'Automated Scheduler: Maintenance Started', status);
        }
      }

      if (status.mode === 'MAINTENANCE' && status.scheduledEnd) {
        if (new Date(status.scheduledEnd) <= now) {
          // Transition back to LIVE
          console.log('✅ [SiteScheduler] Scheduled maintenance ended! Transitioning to LIVE...');
          await transitionTo('LIVE', 'Automated Scheduler: Maintenance Ended', status);
        }
      }
    } catch (error) {
      console.error('❌ [SiteScheduler] Error in scheduler loop:', error);
    }
  }, 3000);
}

export function stopSiteScheduler() {
  if (intervalId) clearInterval(intervalId);
}

async function transitionTo(newMode, reason, currentStatus) {
  const { db } = await import('../../db/client.js');
  const { siteSettingsTable, siteStatusLogsTable } = await import('../../db/schema/site.schema.js');
  const { eq } = await import('drizzle-orm');

  const [settings] = await db.select().from(siteSettingsTable).limit(1);
  if (!settings) return;

  await db.transaction(async (tx) => {
    await tx.update(siteSettingsTable)
      .set({
        mode: newMode,
        // Optional: clear the schedule if it finished
        scheduledStart: newMode === 'LIVE' ? null : settings.scheduledStart,
        scheduledEnd: newMode === 'LIVE' ? null : settings.scheduledEnd,
        updatedAt: new Date()
      })
      .where(eq(siteSettingsTable.id, settings.id));

    await tx.insert(siteStatusLogsTable).values({
      oldMode: currentStatus.mode,
      newMode: newMode,
      reason: reason,
      updatedBy: null, // System
    });

    // Durable Launch Event Trigger
    if (currentStatus.mode === 'COMING_SOON' && newMode === 'LIVE') {
      const { outboxTable } = await import('../../db/schema/outbox.schema.js');
      await tx.insert(outboxTable).values({
        id: `launch-waitlist-${Date.now()}`,
        eventType: 'LAUNCH_WAITLIST_NOTIFY',
        payload: { triggeredBy: 'SYSTEM_SCHEDULER', oldMode: 'COMING_SOON', newMode: 'LIVE', timestamp: new Date().toISOString() },
        processed: false,
      });
    }
  });

  await redis.del('site:status:current');
}
