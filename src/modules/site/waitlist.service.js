// src/modules/site/waitlist.service.js
import { db } from '../../db/client.js';
import { launchWaitlistTable } from '../../db/schema/waitlist.schema.js';
import { usersTable } from '../../db/schema/users.schema.js';
import { eq, sql, desc, asc, like, and, isNull } from 'drizzle-orm';
import { Resend } from 'resend';
import webpush from 'web-push';

const resend = new Resend(process.env.RESEND_API_KEY);
const getSender = () => process.env.RESEND_FROM_EMAIL || 'Devid Aura Luxury <orders@updates.devidaura.com>';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class WaitlistService {
  /**
   * Public: Subscribe an email to the launch waitlist
   */
  static async subscribe(rawEmail) {
    if (!rawEmail || typeof rawEmail !== 'string') {
      throw Object.assign(new Error('Please enter a valid email address.'), { status: 400 });
    }

    const email = rawEmail.trim().toLowerCase();

    if (!EMAIL_REGEX.test(email) || email.length > 255) {
      throw Object.assign(new Error('Please enter a valid email address.'), { status: 400 });
    }

    // Check if already subscribed
    const [existing] = await db
      .select()
      .from(launchWaitlistTable)
      .where(sql`lower(${launchWaitlistTable.email}) = ${email}`)
      .limit(1);

    if (existing) {
      if (existing.status === 'subscribed') {
        return {
          alreadySubscribed: true,
          message: "You're already on the launch list. We'll notify you when we launch.",
        };
      }

      // Re-subscribe if previously marked otherwise
      await db
        .update(launchWaitlistTable)
        .set({ status: 'subscribed', notifiedAt: null })
        .where(eq(launchWaitlistTable.id, existing.id));

      return {
        success: true,
        message: "You're on the launch list. We'll notify you when we launch.",
      };
    }

    // Check if email matches an existing registered user
    const [matchedUser] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(sql`lower(${usersTable.email}) = ${email}`)
      .limit(1);

    // Insert new waitlist subscriber
    await db.insert(launchWaitlistTable).values({
      email,
      userId: matchedUser ? matchedUser.id : null,
      status: 'subscribed',
    });

    return {
      success: true,
      message: "You're on the launch list. We'll notify you when we launch.",
    };
  }

  /**
   * Admin: Get paginated subscribers with search and sorting
   */
  static async getSubscribers({ search = '', sort = 'desc', page = 1, limit = 20 } = {}) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    const conditions = [];
    if (search && search.trim()) {
      const q = `%${search.trim().toLowerCase()}%`;
      conditions.push(sql`lower(${launchWaitlistTable.email}) LIKE ${q}`);
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const orderClause = sort === 'asc' ? asc(launchWaitlistTable.subscribedAt) : desc(launchWaitlistTable.subscribedAt);

    const [countResult] = await db
      .select({ count: sql`count(*)::int` })
      .from(launchWaitlistTable)
      .where(whereClause);

    const total = countResult?.count || 0;

    const rows = await db
      .select({
        id: launchWaitlistTable.id,
        email: launchWaitlistTable.email,
        userId: launchWaitlistTable.userId,
        userName: usersTable.name,
        subscribedAt: launchWaitlistTable.subscribedAt,
        notifiedAt: launchWaitlistTable.notifiedAt,
        status: launchWaitlistTable.status,
      })
      .from(launchWaitlistTable)
      .leftJoin(usersTable, eq(launchWaitlistTable.userId, usersTable.id))
      .where(whereClause)
      .orderBy(orderClause)
      .limit(limitNum)
      .offset(offset);

    const subscribers = rows.map((r) => ({
      id: r.id,
      email: r.email,
      isRegisteredUser: Boolean(r.userId),
      userName: r.userName || null,
      subscribedAt: r.subscribedAt,
      notifiedAt: r.notifiedAt,
      status: r.status,
    }));

    return {
      subscribers,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum) || 1,
    };
  }

  /**
   * Admin: Export all waitlist subscribers as CSV
   */
  static async exportCSV() {
    const rows = await db
      .select({
        email: launchWaitlistTable.email,
        subscribedAt: launchWaitlistTable.subscribedAt,
        status: launchWaitlistTable.status,
        notifiedAt: launchWaitlistTable.notifiedAt,
        userId: launchWaitlistTable.userId,
      })
      .from(launchWaitlistTable)
      .orderBy(desc(launchWaitlistTable.subscribedAt));

    const header = ['Email', 'Subscribed At', 'Status', 'Registered Account', 'Notified At'];
    const csvRows = [header.join(',')];

    for (const r of rows) {
      const subscribed = r.subscribedAt ? new Date(r.subscribedAt).toISOString() : '';
      const notified = r.notifiedAt ? new Date(r.notifiedAt).toISOString() : '';
      const isRegistered = r.userId ? 'Yes' : 'No';

      const escapeCSV = (str) => `"${String(str || '').replace(/"/g, '""')}"`;

      csvRows.push([
        escapeCSV(r.email),
        escapeCSV(subscribed),
        escapeCSV(r.status),
        escapeCSV(isRegistered),
        escapeCSV(notified),
      ].join(','));
    }

    return csvRows.join('\n');
  }

  /**
   * Background Worker: Process launch notifications idempotently
   */
  static async processLaunchNotifications() {
    console.log('🚀 [Waitlist] Starting Launch Notifications dispatch...');

    // Fetch all active subscribers who haven't been notified yet
    const pending = await db
      .select({
        id: launchWaitlistTable.id,
        email: launchWaitlistTable.email,
        userId: launchWaitlistTable.userId,
        pushSubscription: usersTable.pushSubscription,
      })
      .from(launchWaitlistTable)
      .leftJoin(usersTable, eq(launchWaitlistTable.userId, usersTable.id))
      .where(
        and(
          eq(launchWaitlistTable.status, 'subscribed'),
          isNull(launchWaitlistTable.notifiedAt)
        )
      );

    console.log(`📨 [Waitlist] Found ${pending.length} pending subscriber(s) to notify.`);

    if (pending.length === 0) {
      return { total: 0, sent: 0, failed: 0 };
    }

    const publicVapidKey = process.env.VAPID_PUBLIC_KEY;
    const privateVapidKey = process.env.VAPID_PRIVATE_KEY;
    if (publicVapidKey && privateVapidKey) {
      try {
        webpush.setVapidDetails('mailto:devidauraofficial@gmail.com', publicVapidKey, privateVapidKey);
      } catch (err) {
        console.warn('[Waitlist] WebPush VAPID setup warning:', err.message);
      }
    }

    let sentCount = 0;
    let failCount = 0;

    for (const subscriber of pending) {
      try {
        // 1. Attempt WebPush if linked user has active subscription (never blocks email)
        if (subscriber.pushSubscription && publicVapidKey) {
          try {
            await webpush.sendNotification(
              subscriber.pushSubscription,
              JSON.stringify({
                title: 'Devid Aura is Now Live! ✨',
                body: 'We have officially launched. Explore our luxury collection now.',
                url: '/products',
              })
            );
            console.log(`🔔 [Waitlist] WebPush sent to linked user (${subscriber.email})`);
          } catch (pushErr) {
            console.warn(`⚠️ [Waitlist] WebPush failed for ${subscriber.email}:`, pushErr.message);
          }
        }

        // 2. Send Launch Email via Resend
        const emailHtml = `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
              @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600;700&family=Manrope:wght@400;500;600;700;800&display=swap');
              body { font-family: 'Manrope', sans-serif; -webkit-font-smoothing: antialiased; background-color: #050505; color: #ffffff; margin: 0; padding: 0; }
            </style>
          </head>
          <body style="margin: 0; padding: 0; background-color: #050505; color: #ffffff;">
            <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #050505;">
              <tr>
                <td align="center" style="padding: 40px 15px;">
                  <table width="600" border="0" cellspacing="0" cellpadding="0" style="background-color: #0d0d0d; border-radius: 24px; border: 1px solid rgba(255,255,255,0.1); overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,0.8);">
                    
                    <!-- Header -->
                    <tr>
                      <td style="background-color: #000000; padding: 40px 35px 30px; text-align: center; border-bottom: 1px solid rgba(255,255,255,0.08);">
                        <h1 style="font-family: 'Cormorant Garamond', serif; color: #ffffff; margin: 0; font-size: 36px; letter-spacing: 4px; font-weight: 400; text-transform: uppercase;">DEVID AURA</h1>
                        <p style="font-family: 'Manrope', sans-serif; color: #d4af37; margin: 8px 0 0; font-size: 11px; letter-spacing: 3px; text-transform: uppercase; font-weight: 600;">The Essence of Luxury</p>
                      </td>
                    </tr>

                    <!-- Body -->
                    <tr>
                      <td style="padding: 40px 40px 30px; text-align: center;">
                        <div style="background: rgba(212, 175, 55, 0.1); border: 1px solid rgba(212, 175, 55, 0.3); color: #d4af37; padding: 8px 20px; display: inline-block; border-radius: 50px; margin-bottom: 25px; font-size: 12px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase;">
                          ✨ Officially Live
                        </div>

                        <h2 style="font-family: 'Cormorant Garamond', serif; font-size: 36px; font-weight: 600; color: #ffffff; margin: 0 0 15px; line-height: 1.15;">
                          Devid Aura Is Now Live
                        </h2>

                        <p style="font-family: 'Manrope', sans-serif; font-size: 15px; color: #a1a1aa; margin: 0 0 30px; line-height: 1.7; max-width: 480px; display: inline-block;">
                          The wait is over. Our complete luxury fragrance collection is now open for discovery. Thank you for being among the very first on our launch list.
                        </p>

                        <div>
                          <a href="https://devidaura.com/products" style="background-color: #ffffff; color: #000000; padding: 18px 45px; text-decoration: none; border-radius: 50px; font-weight: 700; font-size: 13px; display: inline-block; box-shadow: 0 0 25px rgba(255,255,255,0.3); letter-spacing: 1.5px; text-transform: uppercase;">
                            Discover The Collection →
                          </a>
                        </div>
                      </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                      <td style="background-color: #050505; padding: 25px 35px; text-align: center; border-top: 1px solid rgba(255,255,255,0.06);">
                        <p style="margin: 0; font-size: 12px; color: #71717a;">
                          Devid Aura • Luxury Fragrances
                        </p>
                        <p style="margin: 8px 0 0; font-size: 11px; color: #52525b;">
                          You received this email because you subscribed to the Devid Aura launch waitlist.
                        </p>
                      </td>
                    </tr>

                  </table>
                </td>
              </tr>
            </table>
          </body>
          </html>
        `;

        const { error } = await resend.emails.send({
          from: getSender(),
          to: [subscriber.email],
          subject: 'Devid Aura is now live',
          html: emailHtml,
        });

        if (error) {
          throw new Error(error.message);
        }

        // 3. Mark as notified in Database upon successful email delivery
        await db
          .update(launchWaitlistTable)
          .set({
            status: 'notified',
            notifiedAt: new Date(),
          })
          .where(eq(launchWaitlistTable.id, subscriber.id));

        sentCount++;
        console.log(`✅ [Waitlist] Launch notification sent to ${subscriber.email}`);
      } catch (err) {
        failCount++;
        console.error(`❌ [Waitlist] Failed sending to ${subscriber.email}:`, err.message);
      }
    }

    console.log(`🎉 [Waitlist] Launch notifications complete. Sent: ${sentCount}, Failed: ${failCount}`);
    return { total: pending.length, sent: sentCount, failed: failCount };
  }
}
