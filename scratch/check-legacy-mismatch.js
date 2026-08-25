// scratch/check-legacy-mismatch.js
import { db } from '../src/db/client.js';
import { ordersTable, refundsTable } from '../src/db/schema/index.js';
import { sql } from 'drizzle-orm';

async function check() {
  const result = await db.execute(sql`
    SELECT o.id, o.refund_id, o.refund_amount, o.refund_status
    FROM orders o
    WHERE (o.refund_amount > 0 OR o.refund_id IS NOT NULL)
      AND NOT EXISTS (
        SELECT 1 FROM refunds r WHERE r.order_id = o.id
      )
  `);

  console.log('Orders with legacy refund data missing in refundsTable:', result.rows);
  process.exit(0);
}

check();
