// src/db/schema/notifications.schema.js
import {
  pgTable,
  uuid,
  text,
  boolean,
  varchar,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { usersTable } from './users.schema.js';

export const notificationsTable = pgTable(
  'notifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull().references(() => usersTable.id, { onDelete: 'cascade' }),
    message: text('message').notNull(),
    link: text('link'),
    isRead: boolean('is_read').default(false).notNull(),
    type: varchar('type', { length: 50 }).default('general'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    userIdIdx: index('idx_notifications_user_id').on(table.userId),
  })
);
