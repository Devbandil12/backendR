// src/db/schema/products.schema.js
import {
  pgTable,
  uuid,
  varchar,
  boolean,
  jsonb,
  index
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const productsTable = pgTable('products', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  composition: varchar('composition', { length: 255 }).notNull(),
  description: varchar('description', { length: 255 }).notNull(),
  fragrance: varchar('fragrance', { length: 255 }).notNull(),
  fragranceNotes: varchar('fragranceNotes', { length: 255 }).notNull(),
  imageurl: jsonb('imageurl').notNull().default(sql`'{}'::jsonb`),
  category: varchar('category', { length: 100 }).default('Uncategorized'),
  isArchived: boolean('is_archived').default(false).notNull(),
}, (table) => {
  return {
    categoryIdx: index('product_category_idx').on(table.category),
    archivedIdx: index('product_archived_idx').on(table.isArchived),
  };
});
