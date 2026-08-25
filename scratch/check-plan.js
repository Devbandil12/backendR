import { db } from '../src/db/client.js';
import { sql } from 'drizzle-orm';

async function check() {
  const permRes = await db.execute(sql.raw("SELECT key, name, \"group\" FROM permissions WHERE key LIKE 'orders.%' OR \"group\" = 'orders' ORDER BY key;"));
  console.log('--- Orders Permissions in DB ---');
  console.log(permRes.rows);

  const colRes = await db.execute(sql.raw("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'orders' ORDER BY ordinal_position;"));
  console.log('--- Orders Columns in DB ---');
  console.log(colRes.rows.map(r => r.column_name));

  const countRes = await db.execute(sql.raw("SELECT COUNT(*) FROM orders;"));
  console.log('--- Total Orders Count ---', countRes.rows[0]);

  process.exit(0);
}

check().catch(e => { console.error(e); process.exit(1); });
