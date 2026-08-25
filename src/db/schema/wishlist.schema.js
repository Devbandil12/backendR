// src/db/schema/wishlist.schema.js
import { pgTable, uuid, timestamp } from 'drizzle-orm/pg-core';
import { usersTable } from './users.schema.js';
import { productVariantsTable } from './variants.schema.js';

export const wishlistTable = pgTable('wishlist_table', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => usersTable.id, { onDelete: 'cascade' }),
  variantId: uuid('variant_id').notNull().references(() => productVariantsTable.id, { onDelete: 'cascade' }),
  addedAt: timestamp('added_at', { withTimezone: true }).defaultNow(),
});
