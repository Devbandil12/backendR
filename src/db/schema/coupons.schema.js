// src/db/schema/coupons.schema.js
import {
  pgTable,
  serial,
  integer,
  varchar,
  text,
  boolean,
  timestamp,
  uuid,
  index,
} from 'drizzle-orm/pg-core';
import { usersTable } from './users.schema.js';

export const couponsTable = pgTable('coupons', {
  id: serial('id').primaryKey(),
  code: varchar('code', { length: 50 }).notNull().unique(),
  description: text('description'),
  discountType: varchar('discount_type', { length: 20 }).notNull(),
  discountValue: integer('discount_value').notNull().default(0),
  minOrderValue: integer('min_order_value').default(0),
  minItemCount: integer('min_item_count').default(0),
  maxDiscountAmount: integer('max_discount_amount'),
  validFrom: timestamp('valid_from'),
  validUntil: timestamp('valid_until'),
  firstOrderOnly: boolean('is_first_order_only').default(false),
  maxUsagePerUser: integer('max_usage_per_user').default(1),
  isAutomatic: boolean('is_automatic').default(false).notNull(),
  cond_requiredCategory: varchar('cond_required_category', { length: 100 }),
  action_targetSize: integer('action_target_size'),
  action_targetMaxPrice: integer('action_target_max_price'),
  cond_requiredSize: integer('cond_required_size'),
  action_buyX: integer('action_buy_x'),
  action_getY: integer('action_get_y'),
  targetUserId: uuid('target_user_id').references(() => usersTable.id, { onDelete: 'cascade' }),
  targetCategory: varchar('target_category', { length: 50 }),
  totalUsageLimit: integer('total_usage_limit'),
  isActive: boolean('is_active').default(true).notNull(),
});

export const couponRedemptionsTable = pgTable(
  'coupon_redemptions',
  {
    id: serial('id').primaryKey(),
    couponId: integer('coupon_id').references(() => couponsTable.id).notNull(),
    userId: uuid('user_id').references(() => usersTable.id).notNull(),
    // orderId forward-ref resolved via barrel — imported lazily in relations.js
    orderId: text('order_id').notNull(),
    status: varchar('status').notNull().default('pending'),
    redeemedAt: timestamp('redeemed_at').defaultNow().notNull(),
  },
  (table) => ({
    couponStatusIdx: index('idx_coupon_redemptions_coupon_status').on(table.couponId, table.status),
    couponUserStatusIdx: index('idx_coupon_redemptions_coupon_user_status').on(
      table.couponId,
      table.userId,
      table.status
    ),
    orderIdIdx: index('idx_coupon_redemptions_order_id').on(table.orderId),
  })
);
