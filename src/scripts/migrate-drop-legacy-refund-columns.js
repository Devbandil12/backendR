import { db } from '../db/client.js';
import { sql } from 'drizzle-orm';

async function dropLegacyColumns() {
  console.log("================================================================================");
  console.log("   EXECUTING SCHEMA MIGRATION: DROP OBSOLETE orders.refund_* COLUMNS           ");
  console.log("================================================================================\n");

  console.log("Dropping index orders_refund_status_idx if exists...");
  await db.execute(sql`DROP INDEX IF EXISTS orders_refund_status_idx;`);

  console.log("Dropping 6 legacy refund columns from 'orders' table...");
  await db.execute(sql`
    ALTER TABLE orders
      DROP COLUMN IF EXISTS refund_id,
      DROP COLUMN IF EXISTS refund_amount,
      DROP COLUMN IF EXISTS refund_status,
      DROP COLUMN IF EXISTS refund_speed,
      DROP COLUMN IF EXISTS refund_initiated_at,
      DROP COLUMN IF EXISTS refund_completed_at;
  `);

  console.log("✅ ALTER TABLE completed successfully!");

  // Verify remaining columns on 'orders' table
  const remainingCols = (await db.execute(sql`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'orders'
    ORDER BY ordinal_position;
  `)).rows;

  console.log("\n📋 LIVE 'orders' TABLE COLUMNS (AFTER REMOVAL):");
  console.table(remainingCols);

  const hasLegacyCols = remainingCols.some(c => c.column_name.startsWith('refund_'));
  if (hasLegacyCols) {
    throw new Error("❌ Error: Some legacy refund_* columns still exist!");
  } else {
    console.log("✅ Verified: Zero legacy refund_* columns exist on 'orders' table!");
  }

  // Verify 'refunds' table is completely intact
  const refundsCount = (await db.execute(sql`SELECT COUNT(*)::int as count FROM refunds;`)).rows[0].count;
  console.log(`✅ Verified: 'refunds' table is intact with ${refundsCount} records!`);

  process.exit(0);
}

dropLegacyColumns().catch(err => {
  console.error("FATAL MIGRATION ERROR:", err);
  process.exit(1);
});
