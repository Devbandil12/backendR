import { db } from './src/db/client.js';
import { ticketsTable } from './src/db/schema/index.js';
import { sql } from 'drizzle-orm';

async function run() {
  try {
    const unassigned = await db.select({ count: sql`count(*)` })
      .from(ticketsTable)
      .where(sql`assigned_agent_id IS NULL AND status NOT IN ('closed', 'resolved', 'spam')`);
    console.log('Unassigned from DB:', unassigned);
  } catch (err) {
    console.error(err);
  }
  process.exit(0);
}
run();
