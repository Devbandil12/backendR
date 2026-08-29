// src/db/schema/payments.schema.js
// COD OTP verification tables
import {
  pgTable,
  uuid,
  text,
  integer,
  varchar,
  boolean,
  timestamp, jsonb,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { usersTable } from './users.schema.js';

export const otpVerificationsTable = pgTable(
  'otp_verifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull().references(() => usersTable.id, { onDelete: 'cascade' }),
    phone: text('phone').notNull(),
    otpHash: text('otp_hash').notNull(),
    purpose: varchar('purpose', { length: 30 }).notNull().default('cod_checkout'),
    channel: varchar('channel', { length: 10 }).notNull().default('whatsapp'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    resendCount: integer('resend_count').notNull().default(0),
    verified: boolean('verified').notNull().default(false),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verificationToken: text('verification_token'),
    tokenConsumed: boolean('token_consumed').notNull().default(false),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [index('idx_otp_user_phone').on(table.userId, table.phone)]
);

export const verifiedPhonesTable = pgTable(
  'verified_phones',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull().references(() => usersTable.id, { onDelete: 'cascade' }),
    phone: text('phone').notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [unique('uq_verified_user_phone').on(table.userId, table.phone)]
);
