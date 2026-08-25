import { db } from '../src/db/client.js';
import { sql } from 'drizzle-orm';

async function ensureIndexes() {
  console.log('--- Ensuring indexes on orders, returns, refunds, order_notes ---');
  
  const indexes = [
    `CREATE INDEX IF NOT EXISTS "orders_user_id_idx" ON "orders" ("user_id");`,
    `CREATE INDEX IF NOT EXISTS "orders_created_at_idx" ON "orders" ("created_at");`,
    `CREATE INDEX IF NOT EXISTS "orders_status_idx" ON "orders" ("status");`,
    `CREATE INDEX IF NOT EXISTS "orders_payment_status_idx" ON "orders" ("payment_status");`,
    `CREATE INDEX IF NOT EXISTS "orders_fulfillment_status_idx" ON "orders" ("fulfillment_status");`,
    `CREATE INDEX IF NOT EXISTS "orders_refund_status_idx" ON "orders" ("refund_status");`,
    `CREATE INDEX IF NOT EXISTS "orders_tracking_id_idx" ON "orders" ("tracking_id");`,
    `CREATE INDEX IF NOT EXISTS "orders_shiprocket_awb_idx" ON "orders" ("shiprocket_awb");`,
    `CREATE INDEX IF NOT EXISTS "orders_invoice_number_idx" ON "orders" ("invoice_number");`,
    `CREATE INDEX IF NOT EXISTS "returns_order_id_idx" ON "returns" ("order_id");`,
    `CREATE INDEX IF NOT EXISTS "returns_user_id_idx" ON "returns" ("user_id");`,
    `CREATE INDEX IF NOT EXISTS "returns_status_idx" ON "returns" ("return_status");`,
    `CREATE INDEX IF NOT EXISTS "refunds_order_id_idx" ON "refunds" ("order_id");`,
    `CREATE INDEX IF NOT EXISTS "refunds_status_idx" ON "refunds" ("refund_status");`,
    `CREATE INDEX IF NOT EXISTS "order_notes_order_id_idx" ON "order_notes" ("order_id");`,
    `CREATE INDEX IF NOT EXISTS "order_notes_created_at_idx" ON "order_notes" ("created_at");`
  ];

  for (const idxQuery of indexes) {
    await db.execute(sql.raw(idxQuery));
  }

  console.log('✅ All strategic indexes ensured successfully.');
  process.exit(0);
}

ensureIndexes().catch(err => {
  console.error('Indexing failed:', err);
  process.exit(1);
});
