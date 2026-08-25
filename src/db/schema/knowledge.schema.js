import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  integer,
  index,
} from 'drizzle-orm/pg-core';
import { usersTable } from './users.schema.js';

export const knowledgeArticlesTable = pgTable('knowledge_articles', {
  id: uuid('id').defaultRandom().primaryKey(),
  title: varchar('title', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 255 }).notNull().unique(),
  category: varchar('category', { length: 50 }).notNull(), // SHIPPING, RETURNS, REFUNDS, etc.
  content: text('content').notNull(),
  status: varchar('status', { length: 20 }).default('DRAFT').notNull(), // DRAFT, PUBLISHED, ARCHIVED
  priority: integer('priority').default(0).notNull(), // For sorting or boosting search results
  version: integer('version').default(1).notNull(),
  updatedBy: uuid('updated_by').references(() => usersTable.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  statusIdx: index('knowledge_articles_status_idx').on(table.status),
  categoryIdx: index('knowledge_articles_category_idx').on(table.category),
}));
