import { db } from '../db/client.js';
import { outboxTable } from '../db/schema/outbox.schema.js';
import { supportEmailQueue } from '../infrastructure/queues/support-email.queue.js';
import { eq, and } from 'drizzle-orm';

// Polls the outbox table for unprocessed events and pushes them to BullMQ
export async function processOutbox() {
  try {
    const pendingEvents = await db.select().from(outboxTable).where(eq(outboxTable.processed, false)).limit(50);
    
    if (pendingEvents.length === 0) return;

    for (const event of pendingEvents) {
      if (['TICKET_CREATED', 'TICKET_REPLY', 'SLA_BREACHED'].includes(event.eventType)) {
        await supportEmailQueue.add(event.eventType, {
          type: event.eventType,
          payload: event.payload
        }, { jobId: `outbox-${event.id}` }); // Idempotent job addition based on outbox ID
      }
      
      // Mark as processed
      await db.update(outboxTable).set({ processed: true }).where(eq(outboxTable.id, event.id));
    }
  } catch (error) {
    console.error('❌ [Outbox Processor] Error processing events:', error.message);
  }
}

// Start polling
let polling = false;
setInterval(async () => {
  if (polling) return;
  polling = true;
  await processOutbox();
  polling = false;
}, 5000); // Poll every 5 seconds
