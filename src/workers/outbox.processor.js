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
      } else if (event.eventType === 'LAUNCH_WAITLIST_NOTIFY') {
        const { WaitlistService } = await import('../modules/site/waitlist.service.js');
        await WaitlistService.processLaunchNotifications();
      } else if (event.eventType === 'SCHEDULED_MAINTENANCE_NOTIFY' || event.eventType === 'MAINTENANCE_EXTENDED_NOTIFY') {
        const { processScheduledMaintenanceNotifications } = await import('../modules/site/site.service.js');
        await processScheduledMaintenanceNotifications(event.payload);
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
