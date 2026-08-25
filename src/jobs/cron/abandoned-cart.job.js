// src/jobs/cron/abandoned-cart.job.js
// Moved from: jobs/cron.service.js (abandoned cart section)

import { db } from '../../db/client.js';
import { addToCartTable } from '../../db/schema/cart.schema.js';

// executeRecoveryForUsers is still in routes/notifications.js — re-import from there
// until the notifications module is fully migrated.
import { executeRecoveryForUsers } from '../../modules/notifications/notifications.service.js';

export const runAbandonedCartJob = async () => {
  console.log('🔔 [AUTO] Running Bi-Weekly Abandoned Cart Recovery...');

  try {
    const usersWithCarts = await db
      .selectDistinct({ id: addToCartTable.userId })
      .from(addToCartTable);

    const userIds = usersWithCarts.map((u) => u.id);

    if (userIds.length > 0) {
      console.log(`🎯 Found ${userIds.length} users with abandoned carts. Sending notifications...`);
      await executeRecoveryForUsers(userIds);
      console.log('✅ [AUTO] Recovery Batch Complete.');
    } else {
      console.log('ℹ️ No abandoned carts found today.');
    }
  } catch (error) {
    console.error('❌ [AUTO] Cron Job Failed:', error);
  }
};
