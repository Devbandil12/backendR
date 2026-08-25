import { db } from '../../db/client.js';
import { ticketsTable } from '../../db/schema/index.js';
import { sql, isNull, and, inArray, ne, eq } from 'drizzle-orm';

async function test() {
  try {
    const baseCond = isNull(ticketsTable.deletedAt);
    const agentId = '12345678-1234-1234-1234-123456789012'; // simulate agent ID

    const [
      allOpen,
      myTickets,
      unassigned,
      waitingForCustomer,
      resolved,
    ] = await Promise.all([
      db.select({ count: sql`count(*)` }).from(ticketsTable)
        .where(and(baseCond, inArray(ticketsTable.status, ['new', 'open', 'in_progress', 'pending']))),
      agentId
        ? db.select({ count: sql`count(*)` }).from(ticketsTable)
            .where(and(baseCond, eq(ticketsTable.assignedAgentId, agentId), ne(ticketsTable.status, 'closed'), ne(ticketsTable.status, 'resolved'), ne(ticketsTable.status, 'spam')))
        : [{ count: 0 }],
      db.select({ count: sql`count(*)` }).from(ticketsTable)
        .where(and(baseCond, isNull(ticketsTable.assignedAgentId), ne(ticketsTable.status, 'closed'), ne(ticketsTable.status, 'resolved'), ne(ticketsTable.status, 'spam'))),
      db.select({ count: sql`count(*)` }).from(ticketsTable)
        .where(and(baseCond, eq(ticketsTable.status, 'waiting_for_customer'))),
      db.select({ count: sql`count(*)` }).from(ticketsTable)
        .where(and(baseCond, eq(ticketsTable.status, 'resolved'))),
    ]);

    console.log("Result:", { allOpen, myTickets, unassigned, waitingForCustomer, resolved });
  } catch (err) {
    console.error(err);
  }
}

test();
