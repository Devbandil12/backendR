// src/db/clear.tickets.js
import { db } from './client.js';
import { sql } from 'drizzle-orm';

async function main() {
  console.log('🧹 Dropping legacy support tables...');
  try {
    await db.execute(sql`
      DROP TABLE IF EXISTS ticket_attachments CASCADE;
      DROP TABLE IF EXISTS ticket_events CASCADE;
      DROP TABLE IF EXISTS ticket_messages CASCADE;
      DROP TABLE IF EXISTS tickets CASCADE;
      DROP TABLE IF EXISTS support_teams CASCADE;
      DROP TABLE IF EXISTS support_tags CASCADE;
      DROP TABLE IF EXISTS ticket_counter CASCADE;
    `);
    console.log('✅ Tables dropped successfully!');
  } catch (err) {
    console.error('❌ Error dropping tables:', err.message);
  }
  process.exit(0);
}

main();
