import { db } from '../src/db/client.js';
import { sql } from 'drizzle-orm';

async function migrate() {
  console.log('--- Checking orders table columns ---');
  await db.execute(sql.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'orders' AND column_name = 'version'
      ) THEN
        ALTER TABLE orders ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
        RAISE NOTICE 'Added version column to orders table';
      ELSE
        RAISE NOTICE 'version column already exists on orders table';
      END IF;
    END
    $$;
  `));

  console.log('✅ Migration of version column completed.');

  const res = await db.execute(sql.raw(`
    SELECT id, status, version FROM orders LIMIT 5;
  `));
  console.log('Sample orders with version:', res.rows);
  process.exit(0);
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
