// helpers/codRefusalTiering.js
//
// Part C of the phase-2 plan: instead of a fee or a permanent ban on the
// first COD refusal (refusals aren't always the customer's fault — bad
// courier timing, a damaged item, or a courier misattributing a failed
// delivery attempt as a refusal), respond in tiers:
//
//   1st RTO in the rolling window -> logged only, no action.
//   2nd RTO in the rolling window -> account auto-switched to prepaid-only.
//                                    Removes your financial exposure
//                                    without cutting off a real customer.
//   3rd+                          -> left for human review (flagged via
//                                    the same notification/log trail),
//                                    not an automatic hard block.
//
// Triggered from the Shiprocket webhook the moment a shipment's status
// becomes 'RTO Initiated' — the earliest reliable "this was refused"
// signal (as opposed to 'Returned', which also covers genuine product
// returns and only fires once the package is physically back).

import { db } from '../configs/index.js';
import { ordersTable, usersTable } from '../configs/schema.js';
import { eq, and, gte } from 'drizzle-orm';
import { createNotification } from './notificationManager.js';
import { logger } from '../services/logger.js';

const LOOKBACK_DAYS = Number(process.env.COD_REFUSAL_LOOKBACK_DAYS || 90);
const DISABLE_THRESHOLD = Number(process.env.COD_REFUSAL_DISABLE_THRESHOLD || 2);

export async function handleCodRefusal(order) {
  if (!order || order.paymentMode !== 'cod') return;

  try {
    const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

    const recentRefusals = await db
      .select({ id: ordersTable.id })
      .from(ordersTable)
      .where(and(
        eq(ordersTable.userId, order.userId),
        eq(ordersTable.paymentMode, 'cod'),
        eq(ordersTable.status, 'RTO Initiated'),
        gte(ordersTable.createdAt, cutoff)
      ));

    const refusalCount = recentRefusals.length; // includes this one, since the webhook already wrote the new status before this runs

    if (refusalCount < DISABLE_THRESHOLD) {
      logger.info('[codRefusalTiering] Refusal logged, no action', { userId: order.userId, refusalCount });
      return;
    }

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, order.userId));
    if (!user || user.codDisabled) return; // already handled, or already flagged for a 3rd+ occurrence — don't re-notify every time

    if (refusalCount === DISABLE_THRESHOLD) {
      await db.update(usersTable).set({
        codDisabled: true,
        codDisabledAt: new Date(),
        codDisabledReason: `${refusalCount} refused COD deliveries within ${LOOKBACK_DAYS} days`,
      }).where(eq(usersTable.id, user.id));

      await createNotification(
        user.id,
        "We've switched your account to prepaid orders only, since a couple of recent Cash on Delivery orders weren't accepted at the door. You can still shop as usual — just pay online at checkout.",
        '/myorder',
        'general'
      );

      logger.warn('[codRefusalTiering] COD disabled for user', { userId: user.id, refusalCount });
    } else {
      // 3rd+ occurrence after already being switched to prepaid-only —
      // flag for a human to look at rather than taking further automatic action.
      logger.warn('[codRefusalTiering] User has 3+ refusals post prepaid-only switch — flagging for review', {
        userId: user.id, refusalCount,
      });
    }
  } catch (err) {
    // Never let this block the webhook's main order-update flow.
    logger.error('[codRefusalTiering] Failed', { err: err.message, orderId: order?.id });
  }
}
