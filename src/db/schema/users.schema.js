// src/db/schema/users.schema.js
import {
  pgTable,
  uuid,
  text,
  integer,
  varchar,
  timestamp,
  boolean,
  jsonb,
  index
} from 'drizzle-orm/pg-core';

// ── Users ─────────────────────────────────────────────────────────────────────
export const usersTable = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  clerkId: text('clerk_id').notNull().unique(),
  name: text('name').notNull(),
  phone: text('phone').default(null),
  email: text('email').notNull().unique(),
  profileImage: text('profile_image').default(null),
  dob: timestamp('dob', { withTimezone: true }).default(null),
  gender: text('gender').default(null),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  notify_order_updates: boolean('notify_order_updates').default(true).notNull(),
  notify_promos: boolean('notify_promos').default(true).notNull(),
  notify_pincode: boolean('notify_pincode').default(true).notNull(),
  pushSubscription: jsonb('push_subscription'),
  referralCode: text('referral_code').unique(),
  referredBy: uuid('referred_by'),
  walletBalance: integer('wallet_balance').default(0).notNull(),
  phoneVerified: boolean('phone_verified').default(false).notNull(),
  phoneVerifiedAt: timestamp('phone_verified_at', { withTimezone: true }),
  codDisabled: boolean('cod_disabled').default(false).notNull(),
  codDisabledAt: timestamp('cod_disabled_at', { withTimezone: true }),
  codDisabledReason: text('cod_disabled_reason'),
}, (table) => ({
  clerkIdIdx: index('users_clerk_id_idx').on(table.clerkId),
  emailIdx: index('users_email_idx').on(table.email)
}));

// ── User Addresses ─────────────────────────────────────────────────────────────
export const UserAddressTable = pgTable('user_address', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => usersTable.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  phone: text('phone').notNull(),
  altPhone: text('alt_phone').default(null),
  address: text('address').notNull(),
  city: text('city').notNull(),
  state: text('state').notNull(),
  postalCode: text('postal_code').notNull(),
  country: text('country').notNull().default('India'),
  landmark: text('landmark').default(null),
  deliveryInstructions: text('delivery_instructions').default(null),
  addressType: text('address_type').default(null),
  label: text('label').default(null),
  latitude: text('latitude').default(null),
  longitude: text('longitude').default(null),
  geoAccuracy: text('geo_accuracy').default(null),
  isDefault: boolean('is_default').default(false),
  isVerified: boolean('is_verified').default(false),
  isDeleted: boolean('is_deleted').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  userIdIdx: index('user_address_user_id_idx').on(table.userId)
}));

// ── Wallet Transactions ────────────────────────────────────────────────────────
export const walletTransactionsTable = pgTable('wallet_transactions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => usersTable.id, { onDelete: 'cascade' }),
  amount: integer('amount').notNull(),
  type: varchar('type', { length: 50 }).notNull(),
  description: text('description').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  userIdIdx: index('wallet_transactions_user_id_idx').on(table.userId)
}));
