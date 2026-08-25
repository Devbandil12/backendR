// src/db/schema/returns.schema.js
import {
  pgTable,
  text,
  uuid,
  integer,
  timestamp,
  index
} from 'drizzle-orm/pg-core';
import { usersTable } from './users.schema.js';
import { ordersTable, orderItemsTable } from './orders.schema.js';

export const returnsTable = pgTable('returns', {
  id: uuid('id').defaultRandom().primaryKey().notNull(),
  orderId: text('order_id').notNull().references(() => ordersTable.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => usersTable.id),
  returnStatus: text('return_status').default('REQUESTED'), // NONE / REQUESTED / APPROVED / PICKED_UP / RECEIVED / REJECTED
  reason: text('reason').notNull(),
  adminNotes: text('admin_notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => {
  return {
    orderIdIdx: index('returns_order_id_idx').on(table.orderId),
    userIdIdx: index('returns_user_id_idx').on(table.userId),
    statusIdx: index('returns_status_idx').on(table.returnStatus),
  };
});

export const returnItemsTable = pgTable('return_items', {
  id: uuid('id').defaultRandom().primaryKey().notNull(),
  returnId: uuid('return_id').notNull().references(() => returnsTable.id, { onDelete: 'cascade' }),
  orderItemId: text('order_item_id').notNull().references(() => orderItemsTable.id),
  quantity: integer('quantity').notNull().default(1),
  condition: text('condition'),
});

export const refundsTable = pgTable('refunds', {
  id: uuid('id').defaultRandom().primaryKey().notNull(),
  orderId: text('order_id').notNull().references(() => ordersTable.id, { onDelete: 'cascade' }),
  returnId: uuid('return_id').references(() => returnsTable.id, { onDelete: 'set null' }), // Can be null if refund is for cancellation, not return
  amount: integer('amount').notNull(), // in paise (same as legacy orders.refund_amount)
  refundStatus: text('refund_status').default('pending'), // lowercase legacy: pending / in_progress / processed / failed
  refundSpeed: text('refund_speed'), // optimum / instant / normal
  gatewayRefundId: text('gateway_refund_id'),
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => {
  return {
    orderIdIdx: index('refunds_order_id_idx').on(table.orderId),
    statusIdx: index('refunds_status_idx').on(table.refundStatus),
    gatewayRefundIdIdx: index('refunds_gateway_refund_id_idx').on(table.gatewayRefundId),
  };
});
