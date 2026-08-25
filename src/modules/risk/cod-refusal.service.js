// src/modules/risk/cod-refusal.service.js
// Moved from: modules/risk/cod-refusal.service.js
// Tiered COD refusal handler — triggered by Shiprocket webhook on RTO Initiated status.

import { db } from '../../db/client.js';
import { ordersTable, usersTable } from '../../db/schema/index.js';
import { eq, and, gte } from 'drizzle-orm';
import { logger } from '../../observability/logger.js';

const LOOKBACK_DAYS = Number(process.env.COD_REFUSAL_LOOKBACK_DAYS || 90);
const DISABLE_THRESHOLD = Number(process.env.COD_REFUSAL_DISABLE_THRESHOLD || 2);

// createNotification still lives in routes/notifications.js
// Import from there until the notifications module is fully migrated.
async function createNotification(userId, message, link, type) {
  try {
    const { createNotification: _create } = await import('../notifications/notifications.service.js');
    return _create(userId, message, link, type);
  } catch {
    logger.warn('[codRefusalTiering] Could not import createNotification');
  }
}

export async function handleCodRefusal(order) {
  if (!order || order.paymentMode !== 'cod') return;

  try {
    const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

    const recentRefusals = await db
      .select({ id: ordersTable.id })
      .from(ordersTable)
      .where(
        and(
          eq(ordersTable.userId, order.userId),
          eq(ordersTable.paymentMode, 'cod'),
          eq(ordersTable.status, 'RTO Initiated'),
          gte(ordersTable.createdAt, cutoff)
        )
      );

    const refusalCount = recentRefusals.length;

    if (refusalCount < DISABLE_THRESHOLD) {
      logger.info('[codRefusalTiering] Refusal logged, no action', { userId: order.userId, refusalCount });
      return;
    }

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, order.userId));
    if (!user || user.codDisabled) return;

    if (refusalCount === DISABLE_THRESHOLD) {
      await db
        .update(usersTable)
        .set({
          codDisabled: true,
          codDisabledAt: new Date(),
          codDisabledReason: `${refusalCount} refused COD deliveries within ${LOOKBACK_DAYS} days`,
        })
        .where(eq(usersTable.id, user.id));

      await createNotification(
        user.id,
        "We've switched your account to prepaid orders only, since a couple of recent Cash on Delivery orders weren't accepted at the door. You can still shop as usual — just pay online at checkout.",
        '/myorder',
        'general'
      );

      logger.warn('[codRefusalTiering] COD disabled for user', { userId: user.id, refusalCount });
    } else {
      logger.warn('[codRefusalTiering] User has 3+ refusals post prepaid-only switch — flagging for review', {
        userId: user.id,
        refusalCount,
      });
    }
  } catch (err) {
    logger.error('[codRefusalTiering] Failed', { err: err.message, orderId: order?.id });
  }
}

