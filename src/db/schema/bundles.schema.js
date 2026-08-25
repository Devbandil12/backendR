// src/db/schema/bundles.schema.js
import { pgTable, uuid, integer } from 'drizzle-orm/pg-core';
import { productVariantsTable } from './variants.schema.js';

export const productBundlesTable = pgTable('product_bundles', {
  id: uuid('id').defaultRandom().primaryKey(),
  bundleVariantId: uuid('bundle_variant_id')
    .notNull()
    .references(() => productVariantsTable.id, { onDelete: 'cascade' }),
  contentVariantId: uuid('content_variant_id')
    .notNull()
    .references(() => productVariantsTable.id, { onDelete: 'cascade' }),
  quantity: integer('quantity').notNull().default(1),
});
