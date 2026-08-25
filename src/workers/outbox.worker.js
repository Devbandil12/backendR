// src/workers/outbox.worker.js
import { db } from '../db/client.js';
import { outboxTable } from '../db/schema/index.js';
import { eq, inArray } from 'drizzle-orm';
import { addToEmailQueue } from '../infrastructure/queues/email.queue.js';

export const processOutbox = async () => {
  try {
    const pendingEvents = await db.select().from(outboxTable).where(eq(outboxTable.processed, false)).limit(100);
    
    if (pendingEvents.length > 0) {
      await Promise.all(pendingEvents.map(async (event) => {
        if (event.eventType === 'ORDER_CREATED') {
          await addToEmailQueue(event.payload);
        }
      }));

      const ids = pendingEvents.map(e => e.id);
      await db.update(outboxTable).set({ processed: true }).where(inArray(outboxTable.id, ids));
    }
  } catch (error) {
    console.error('Outbox processing failed:', error);
  }
};
