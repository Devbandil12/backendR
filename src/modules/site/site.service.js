import { db } from '../../db/client.js';
import { siteSettingsTable, siteStatusLogsTable, globalAnnouncementsTable } from '../../db/schema/site.schema.js';
import { usersTable } from '../../db/schema/users.schema.js';
import { eq, desc, and, or, sql } from 'drizzle-orm';
import { redis } from '../../config/redis.js';

const SITE_STATUS_CACHE_KEY = 'site:status:current';

// ── Site Status ───────────────────────────────────────────────────────────────

export async function getSiteStatus() {
  // Check Redis first for extreme performance
  const cached = await redis.get(SITE_STATUS_CACHE_KEY);
  if (cached) {
    return JSON.parse(cached);
  }

  // Fallback to DB
  let [settings] = await db.select().from(siteSettingsTable).limit(1);

  if (!settings) {
    // Initialize default if missing
    [settings] = await db.insert(siteSettingsTable).values({ mode: 'LIVE' }).returning();
  }

  const payload = {
    mode: settings.mode,
    scheduledStart: settings.scheduledStart,
    scheduledEnd: settings.scheduledEnd,
    title: settings.title,
    message: settings.message,
    showCountdown: settings.showCountdown,
    bypassEnabled: settings.bypassEnabled,
    serverTime: new Date(),
  };

  await redis.set(SITE_STATUS_CACHE_KEY, JSON.stringify(payload));
  return payload;
}

export async function updateSiteStatus(clerkId, payload) {
  const { mode, scheduledStart, scheduledEnd, title, message, showCountdown, bypassEnabled, reason } = payload;
  
  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
  if (!user) throw new Error('User not found');

  const [current] = await db.select().from(siteSettingsTable).limit(1);
  const oldMode = current ? current.mode : 'UNKNOWN';

  return await db.transaction(async (tx) => {
    let newSettings;
    if (current) {
      [newSettings] = await tx.update(siteSettingsTable)
        .set({
          mode: mode || current.mode,
          scheduledStart: scheduledStart !== undefined ? scheduledStart : current.scheduledStart,
          scheduledEnd: scheduledEnd !== undefined ? scheduledEnd : current.scheduledEnd,
          title: title !== undefined ? title : current.title,
          message: message !== undefined ? message : current.message,
          showCountdown: showCountdown !== undefined ? showCountdown : current.showCountdown,
          bypassEnabled: bypassEnabled !== undefined ? bypassEnabled : current.bypassEnabled,
          updatedBy: user.id,
          updatedAt: new Date(),
        })
        .where(eq(siteSettingsTable.id, current.id))
        .returning();
    } else {
      [newSettings] = await tx.insert(siteSettingsTable)
        .values({
          mode, scheduledStart, scheduledEnd, title, message, showCountdown, bypassEnabled, updatedBy: user.id
        })
        .returning();
    }

    if (oldMode !== newSettings.mode) {
      await tx.insert(siteStatusLogsTable).values({
        oldMode,
        newMode: newSettings.mode,
        reason: reason || 'Manual update',
        updatedBy: user.id,
      });
    }

    // Invalidate Cache
    await redis.del(SITE_STATUS_CACHE_KEY);

    return newSettings;
  });
}

// ── Global Announcements ──────────────────────────────────────────────────────

export async function getActiveAnnouncements() {
  const now = new Date();
  
  // Get announcements where isActive = true AND (startAt is null or past) AND (endAt is null or future)
  return await db.select()
    .from(globalAnnouncementsTable)
    .where(
      and(
        eq(globalAnnouncementsTable.isActive, true),
        or(sql`${globalAnnouncementsTable.startAt} IS NULL`, sql`${globalAnnouncementsTable.startAt} <= ${now}`),
        or(sql`${globalAnnouncementsTable.endAt} IS NULL`, sql`${globalAnnouncementsTable.endAt} > ${now}`)
      )
    )
    .orderBy(desc(globalAnnouncementsTable.createdAt));
}

export async function createAnnouncement(clerkId, data) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
  if (!user) throw new Error('User not found');

  const [announcement] = await db.insert(globalAnnouncementsTable)
    .values({ ...data, createdBy: user.id })
    .returning();
    
  return announcement;
}
