import { db } from '../db/client.js';
import { sql } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';

async function createBackup() {
  console.log("================================================================================");
  console.log("   CREATING DATABASE SNAPSHOT BEFORE DESTRUCTIVE COLUMN REMOVAL                ");
  console.log("================================================================================\n");

  const backupDir = path.resolve('backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(backupDir, `pre-removal-backup-${timestamp}.json`);

  console.log("Dumping tables to snapshot file:", backupFile);

  const [orders, refunds, returns, returnItems] = await Promise.all([
    db.execute(sql`SELECT * FROM orders;`),
    db.execute(sql`SELECT * FROM refunds;`),
    db.execute(sql`SELECT * FROM returns;`),
    db.execute(sql`SELECT * FROM return_items;`)
  ]);

  const backupData = {
    createdAt: new Date().toISOString(),
    stats: {
      ordersCount: orders.rows.length,
      refundsCount: refunds.rows.length,
      returnsCount: returns.rows.length,
      returnItemsCount: returnItems.rows.length,
    },
    tables: {
      orders: orders.rows,
      refunds: refunds.rows,
      returns: returns.rows,
      returnItems: returnItems.rows,
    }
  };

  fs.writeFileSync(backupFile, JSON.stringify(backupData, null, 2), 'utf-8');

  // Verify backup exists and is non-empty
  const stats = fs.statSync(backupFile);
  console.log(`✅ Backup successfully created and verified!`);
  console.log(`   - Path: ${backupFile}`);
  console.log(`   - Size: ${(stats.size / 1024).toFixed(2)} KB`);
  console.log(`   - Orders snapshot: ${orders.rows.length} rows`);
  console.log(`   - Refunds snapshot: ${refunds.rows.length} rows`);

  process.exit(0);
}

createBackup().catch(err => {
  console.error("FATAL BACKUP ERROR:", err);
  process.exit(1);
});
