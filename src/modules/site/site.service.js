import { db } from '../../db/client.js';
import { siteSettingsTable, siteStatusLogsTable, globalAnnouncementsTable } from '../../db/schema/site.schema.js';
import { outboxTable } from '../../db/schema/outbox.schema.js';
import { usersTable } from '../../db/schema/users.schema.js';
import { eq, desc, and, or, sql } from 'drizzle-orm';
import { redis } from '../../config/redis.js';

const SITE_STATUS_CACHE_KEY = 'site:status:current';

// ── Site Status ───────────────────────────────────────────────────────────────

export async function getSiteStatus() {
  // Check Redis first for extreme performance
  const cached = await redis.get(SITE_STATUS_CACHE_KEY);
  if (cached) {
    const parsed = JSON.parse(cached);
    // Check if cached maintenance has expired
    if (parsed.mode === 'MAINTENANCE' && parsed.scheduledEnd && new Date(parsed.scheduledEnd) <= new Date()) {
      await redis.del(SITE_STATUS_CACHE_KEY);
    } else {
      return parsed;
    }
  }

  // Fallback to DB
  let [settings] = await db.select().from(siteSettingsTable).limit(1);

  if (!settings) {
    // Initialize default if missing
    [settings] = await db.insert(siteSettingsTable).values({ mode: 'LIVE' }).returning();
  }

  // Self-heal: If scheduled maintenance has passed, automatically transition to LIVE
  const now = new Date();
  if (settings.mode === 'MAINTENANCE' && settings.scheduledEnd && new Date(settings.scheduledEnd) <= now) {
    console.log('⏰ [SiteService] Scheduled maintenance ended. Auto-reactivating site to LIVE...');
    [settings] = await db.update(siteSettingsTable)
      .set({
        mode: 'LIVE',
        scheduledStart: null,
        scheduledEnd: null,
        showCountdown: false,
        updatedAt: now,
      })
      .where(eq(siteSettingsTable.id, settings.id))
      .returning();

    await db.insert(siteStatusLogsTable).values({
      oldMode: 'MAINTENANCE',
      newMode: 'LIVE',
      reason: 'Scheduled Maintenance Auto-Ended',
      updatedBy: null,
    });
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
  const { mode, scheduledStart, scheduledEnd, title, message, showCountdown, bypassEnabled, reason, isExtension } = payload;
  
  const [user] = clerkId ? await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId)) : [null];
  const userId = user?.id || null;

  const now = new Date();
  const [current] = await db.select().from(siteSettingsTable).limit(1);
  const oldMode = current ? current.mode : 'UNKNOWN';

  const parseSafeDate = (val) => {
    if (val === null || val === undefined || val === '') return null;
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  };

  const hasStartInPayload = scheduledStart !== undefined;
  const hasEndInPayload = scheduledEnd !== undefined;

  const incomingStart = hasStartInPayload ? parseSafeDate(scheduledStart) : undefined;
  const incomingEnd = hasEndInPayload ? parseSafeDate(scheduledEnd) : undefined;

  // Case A: Explicit Extension or End-time update on active schedule
  const isExtending = isExtension || (current?.scheduledEnd && incomingEnd && !hasStartInPayload);

  if (isExtending && current?.scheduledEnd && incomingEnd) {
    const currentEnd = new Date(current.scheduledEnd);
    if (incomingEnd.getTime() <= currentEnd.getTime()) {
      throw Object.assign(new Error('New end time must be later than the current scheduled end time.'), { status: 400 });
    }
  } else if (incomingStart) {
    // Case B: Scheduling new maintenance window
    if (incomingStart.getTime() < now.getTime() + 29.5 * 60 * 1000) {
      throw Object.assign(new Error('Maintenance start time must be at least 30 minutes in the future.'), { status: 400 });
    }

    if (incomingEnd && incomingEnd.getTime() <= incomingStart.getTime()) {
      throw Object.assign(new Error('Maintenance end time must be after the start time.'), { status: 400 });
    }
  }

  const parsedStart = isExtending
    ? current?.scheduledStart
    : (hasStartInPayload ? incomingStart : current?.scheduledStart);

  const parsedEnd = hasEndInPayload ? incomingEnd : current?.scheduledEnd;

  return await db.transaction(async (tx) => {
    let newSettings;
    if (current) {
      [newSettings] = await tx.update(siteSettingsTable)
        .set({
          mode: mode || current.mode,
          scheduledStart: parsedStart,
          scheduledEnd: parsedEnd,
          title: title !== undefined ? title : current.title,
          message: message !== undefined ? message : current.message,
          showCountdown: showCountdown !== undefined ? showCountdown : current.showCountdown,
          bypassEnabled: bypassEnabled !== undefined ? bypassEnabled : current.bypassEnabled,
          updatedBy: userId,
          updatedAt: new Date(),
        })
        .where(eq(siteSettingsTable.id, current.id))
        .returning();
    } else {
      [newSettings] = await tx.insert(siteSettingsTable)
        .values({
          mode: mode || 'LIVE',
          scheduledStart: parsedStart || null,
          scheduledEnd: parsedEnd || null,
          title: title || null,
          message: message || null,
          showCountdown: showCountdown || false,
          bypassEnabled: bypassEnabled !== undefined ? bypassEnabled : true,
          updatedBy: userId
        })
        .returning();
    }

    if (oldMode !== newSettings.mode) {
      await tx.insert(siteStatusLogsTable).values({
        oldMode,
        newMode: newSettings.mode,
        reason: reason || (isExtending ? 'Maintenance Extended' : 'Manual update'),
        updatedBy: userId,
      });

      // Durable Launch Event Trigger
      if (oldMode === 'COMING_SOON' && newSettings.mode === 'LIVE') {
        await tx.insert(outboxTable).values({
          id: `launch-waitlist-${Date.now()}`,
          eventType: 'LAUNCH_WAITLIST_NOTIFY',
          payload: { triggeredBy: userId, oldMode, newMode: 'LIVE', timestamp: new Date().toISOString() },
          processed: false,
        });
      }
    }

    // Trigger Outbox notification for Extension vs New Scheduled Maintenance
    if (isExtending && current?.scheduledEnd && parsedEnd && parsedEnd.getTime() > new Date(current.scheduledEnd).getTime()) {
      await tx.insert(outboxTable).values({
        id: `maint-ext-${Date.now()}`,
        eventType: 'MAINTENANCE_EXTENDED_NOTIFY',
        payload: {
          scheduledStart: current.scheduledStart ? new Date(current.scheduledStart).toISOString() : null,
          scheduledEnd: parsedEnd.toISOString(),
          oldScheduledEnd: new Date(current.scheduledEnd).toISOString(),
          title: title || 'Scheduled Maintenance Extended',
          message: message || 'Our scheduled maintenance has been extended to complete necessary system enhancements.',
          isExtension: true,
          timestamp: new Date().toISOString(),
        },
        processed: false,
      });
    } else if (!isExtending && parsedStart && parsedStart > now && (!current?.scheduledStart || new Date(current.scheduledStart).getTime() !== parsedStart.getTime())) {
      await tx.insert(outboxTable).values({
        id: `sched-maint-${Date.now()}`,
        eventType: 'SCHEDULED_MAINTENANCE_NOTIFY',
        payload: {
          scheduledStart: parsedStart.toISOString(),
          scheduledEnd: parsedEnd ? parsedEnd.toISOString() : null,
          title: title || 'Scheduled Maintenance Notice',
          message: message || 'We are performing scheduled maintenance to upgrade our systems.',
          isExtension: false,
          timestamp: new Date().toISOString(),
        },
        processed: false,
      });
    }

    // Invalidate Cache
    await redis.del(SITE_STATUS_CACHE_KEY);

    return newSettings;
  });
}

// ── Scheduled Maintenance Notifications ───────────────────────────────────────

export async function processScheduledMaintenanceNotifications(payload) {
  const { scheduledStart, scheduledEnd, oldScheduledEnd, title, message, isExtension } = payload;
  const { notificationsTable } = await import('../../db/schema/notifications.schema.js');
  const { usersTable } = await import('../../db/schema/users.schema.js');
  const { Resend } = await import('resend');
  const webpush = (await import('web-push')).default;

  const resend = new Resend(process.env.RESEND_API_KEY);
  const getSender = () => process.env.RESEND_FROM_EMAIL || 'Devid Aura Luxury <orders@updates.devidaura.com>';

  const formattedStart = scheduledStart
    ? new Intl.DateTimeFormat('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      }).format(new Date(scheduledStart))
    : 'Active Maintenance';

  const formattedEnd = scheduledEnd
    ? new Intl.DateTimeFormat('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      }).format(new Date(scheduledEnd))
    : 'To Be Announced';

  console.log(`📣 [Maintenance Notification] Dispatching ${isExtension ? 'Extension' : 'Scheduled'} notices for window: ${formattedStart} -> ${formattedEnd}`);

  const allUsers = await db.select().from(usersTable);
  if (!allUsers || allUsers.length === 0) return;

  const noticeMessage = isExtension
    ? `⚠️ Maintenance Extended: Devid Aura scheduled maintenance has been extended until ${formattedEnd}. We will be back online shortly.`
    : `⚠️ Scheduled Maintenance: Devid Aura will undergo scheduled maintenance from ${formattedStart} until ${formattedEnd}. The site will be temporarily offline.`;

  const emailSubject = isExtension
    ? `[Update] Scheduled Maintenance Extended — Devid Aura`
    : `Scheduled Maintenance Notice — Devid Aura`;

  for (const user of allUsers) {
    // 1. In-App Notification
    try {
      await db.insert(notificationsTable).values({
        userId: user.id,
        message: noticeMessage,
        type: 'maintenance',
        link: '/',
      });
    } catch (err) {
      console.warn(`Failed in-app notification for user ${user.id}:`, err.message);
    }

    // 2. WebPush Notification
    if (user.pushSubscription) {
      try {
        await webpush.sendNotification(
          user.pushSubscription,
          JSON.stringify({
            title: isExtension ? 'Devid Aura • Maintenance Extended' : 'Devid Aura • Scheduled Maintenance',
            body: isExtension ? `Maintenance extended until ${formattedEnd}.` : `Maintenance scheduled from ${formattedStart} to ${formattedEnd}.`,
            icon: '/devidaura-logo.webp',
            url: '/',
          })
        );
      } catch (err) {
        // Push errors are non-fatal
      }
    }

    // 3. Email Notification via Resend
    if (user.email && process.env.RESEND_API_KEY) {
      try {
        await resend.emails.send({
          from: getSender(),
          to: [user.email],
          subject: emailSubject,
          html: `
            <div style="background:#050505;color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:40px 20px;max-width:600px;margin:0 auto;border-radius:16px;border:1px solid #222;">
              <div style="text-align:center;margin-bottom:30px;">
                <h1 style="color:#ffffff;font-size:24px;font-weight:300;letter-spacing:4px;text-transform:uppercase;margin:0;">Devid Aura</h1>
                <p style="color:#f59e0b;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-top:8px;">${isExtension ? 'Maintenance Window Extended' : 'Scheduled System Maintenance'}</p>
              </div>
              <div style="background:#111;border:1px solid #333;border-radius:12px;padding:24px;margin-bottom:24px;">
                <p style="color:#d4d4d8;font-size:15px;line-height:1.6;margin:0 0 16px 0;">
                  Dear ${user.name || 'Valued Customer'},
                </p>
                <p style="color:#a1a1aa;font-size:14px;line-height:1.6;margin:0 0 20px 0;">
                  ${message || (isExtension ? 'Our ongoing scheduled maintenance has been extended to complete necessary system enhancements.' : 'We will be conducting scheduled system enhancements to improve platform performance and reliability. During this window, access to the Devid Aura store will be temporarily paused.')}
                </p>
                <div style="background:#000;border-left:3px solid #f59e0b;padding:16px;border-radius:6px;margin-bottom:16px;">
                  ${!isExtension ? `<p style="margin:0 0 8px 0;font-size:13px;color:#d4d4d8;"><strong>Starts:</strong> ${formattedStart}</p>` : ''}
                  <p style="margin:0;font-size:13px;color:#d4d4d8;"><strong>${isExtension ? 'New Expected Completion:' : 'Expected Completion:'}</strong> ${formattedEnd}</p>
                </div>
                <p style="color:#71717a;font-size:12px;line-height:1.5;margin:0;">
                  Any ongoing shopping sessions or orders are safely preserved. We appreciate your patience as we elevate your luxury fragrance experience.
                </p>
              </div>
              <p style="color:#52525b;font-size:11px;text-align:center;margin:0;">
                © ${new Date().getFullYear()} Devid Aura Luxury. All rights reserved.
              </p>
            </div>
          `,
        });
      } catch (emailErr) {
        console.warn(`Failed maintenance email to ${user.email}:`, emailErr.message);
      }
    }
  }

  console.log(`✅ [Maintenance Notification] Dispatched notices to ${allUsers.length} users`);
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

  const insertData = {
    ...data,
    startAt: data.startAt ? new Date(data.startAt) : null,
    endAt: data.endAt ? new Date(data.endAt) : null,
    createdBy: user.id
  };

  const [announcement] = await db.insert(globalAnnouncementsTable)
    .values(insertData)
    .returning();
    
  return announcement;
}


