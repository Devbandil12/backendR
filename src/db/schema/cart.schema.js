// src/db/schema/cart.schema.js
import { pgTable, uuid, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { usersTable } from './users.schema.js';
import { productVariantsTable } from './variants.schema.js';

export const addToCartTable = pgTable('add_to_cart', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => usersTable.id, { onDelete: 'cascade' }),
  variantId: uuid('variant_id').notNull().references(() => productVariantsTable.id, { onDelete: 'cascade' }),
  quantity: integer('quantity').notNull().default(1),
  addedAt: timestamp('added_at', { withTimezone: true }).defaultNow(),
});

export const savedForLaterTable = pgTable('saved_for_later', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => usersTable.id, { onDelete: 'cascade' }),
  variantId: uuid('variant_id').notNull().references(() => productVariantsTable.id, { onDelete: 'cascade' }),
  quantity: integer('quantity').notNull().default(1),
  addedAt: timestamp('added_at', { withTimezone: true }).defaultNow(),
});
