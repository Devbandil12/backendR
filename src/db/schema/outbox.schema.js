import { pgTable, text, timestamp, boolean, jsonb } from 'drizzle-orm/pg-core';

export const outboxTable = pgTable('outbox', {
  id: text('id').primaryKey(),
  eventType: text('event_type').notNull(),
  payload: jsonb('payload').notNull(),
  processed: boolean('processed').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
