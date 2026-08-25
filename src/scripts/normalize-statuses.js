import { db } from '../db/client.js';
import { sql } from 'drizzle-orm';

async function normalizeAndAudit() {
  console.log("Normalizing any legacy non-standard statuses in refunds table to lowercase standard...");
  await db.execute(sql`
    UPDATE refunds SET refund_status = 'processed' WHERE LOWER(refund_status) = 'completed' OR LOWER(refund_status) = 'processed';
    UPDATE refunds SET refund_status = 'pending' WHERE LOWER(refund_status) = 'pending';
    UPDATE refunds SET refund_status = 'in_progress' WHERE LOWER(refund_status) = 'in_progress' OR LOWER(refund_status) = 'processing';
    UPDATE refunds SET refund_status = 'failed' WHERE LOWER(refund_status) = 'failed';
  `);

  console.log("Re-checking status distribution in refunds table:");
  const statusCounts = (await db.execute(sql`
    SELECT refund_status, COUNT(*)::int as count
    FROM refunds
    GROUP BY refund_status;
  `)).rows;
  console.table(statusCounts);
}

normalizeAndAudit().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
