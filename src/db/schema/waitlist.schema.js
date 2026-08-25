// src/db/schema/waitlist.schema.js
import { pgTable, uuid, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { usersTable } from './users.schema.js';
import { sql } from 'drizzle-orm';

export const launchWaitlistTable = pgTable('launch_waitlist', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull(),
  userId: uuid('user_id').references(() => usersTable.id, { onDelete: 'set null' }),
  subscribedAt: timestamp('subscribed_at', { withTimezone: true }).defaultNow().notNull(),
  notifiedAt: timestamp('notified_at', { withTimezone: true }),
  status: text('status').default('subscribed').notNull(), // 'subscribed' | 'notified'
}, (table) => [
  uniqueIndex('launch_waitlist_email_unique_idx').on(sql`lower(${table.email})`)
]);
