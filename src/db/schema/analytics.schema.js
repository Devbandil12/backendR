// src/db/schema/analytics.schema.js
import { pgTable, uuid, integer, varchar, timestamp, serial, index } from 'drizzle-orm/pg-core';
import { usersTable } from './users.schema.js';

export const analyticsEventsTable = pgTable('analytics_events', {
  id: serial('id').primaryKey(),
  eventType: varchar('event_type', { length: 50 }).notNull(), // e.g., 'page_view', 'add_to_cart', 'checkout_started'
  userId: uuid('user_id').references(() => usersTable.id, { onDelete: 'set null' }),
  sessionId: varchar('session_id', { length: 100 }), // for anonymous tracking
  metadata: varchar('metadata', { length: 255 }), // e.g. path or product id
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    eventTypeIdx: index('idx_analytics_events_type').on(table.eventType),
    createdAtIdx: index('idx_analytics_events_created_at').on(table.createdAt)
}));
