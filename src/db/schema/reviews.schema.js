// src/db/schema/reviews.schema.js
import {
  pgTable,
  uuid,
  integer,
  text,
  boolean,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { productsTable } from './products.schema.js';
import { usersTable } from './users.schema.js';

export const reviewsTable = pgTable(
  'product_reviews',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    productId: uuid('product_id').notNull().references(() => productsTable.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => usersTable.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    rating: integer('rating').notNull(),
    comment: text('comment').notNull(),
    photoUrls: text('photo_urls').array(),
    isVerifiedBuyer: boolean('is_verified_buyer').default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    productIdIdx: index('idx_reviews_product_id').on(table.productId),
    ratingIdx: index('idx_reviews_rating').on(table.rating),
    createdAtIdx: index('idx_reviews_created_at').on(table.createdAt),
  })
);
