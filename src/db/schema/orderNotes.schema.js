// src/db/schema/orderNotes.schema.js
import {
  pgTable,
  text,
  uuid,
  boolean,
  timestamp,
  index
} from 'drizzle-orm/pg-core';
import { usersTable } from './users.schema.js';
import { ordersTable } from './orders.schema.js';

export const orderNotesTable = pgTable('order_notes', {
  id: uuid('id').defaultRandom().primaryKey().notNull(),
  orderId: text('order_id').notNull().references(() => ordersTable.id, { onDelete: 'cascade' }),
  adminId: uuid('admin_id').notNull().references(() => usersTable.id),
  note: text('note').notNull(),
  isInternal: boolean('is_internal').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => {
  return {
    orderIdIdx: index('order_notes_order_id_idx').on(table.orderId),
  };
});
