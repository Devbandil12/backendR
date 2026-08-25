// src/db/schema/variants.schema.js
import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  varchar,
  real,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { productsTable } from './products.schema.js';

export const productVariantsTable = pgTable('product_variants', {
  id: uuid('id').defaultRandom().primaryKey(),
  productId: uuid('product_id').notNull().references(() => productsTable.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  size: integer('size').notNull(),
  oprice: integer('oprice').notNull(),
  discount: integer('discount').notNull().default(0),
  costPrice: integer('cost_price').default(0),
  stock: integer('stock').notNull().default(0),
  sold: integer('sold').default(0),
  isArchived: boolean('is_archived').default(false).notNull(),
  sku: varchar('sku', { length: 100 }).unique(),
  weight: real('weight').default(0.5).notNull(),
  length: real('length').default(10),
  breadth: real('breadth').default(10),
  height: real('height').default(10),
  is_active: boolean('is_active').default(true),
}, (table) => {
  return {
    stockCheck: check('stock_check', sql`${table.stock} >= 0`),
  };
});
