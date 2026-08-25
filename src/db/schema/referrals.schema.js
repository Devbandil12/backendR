// src/db/schema/referrals.schema.js
import {
  pgTable,
  uuid,
  integer,
  varchar,
  timestamp,
} from 'drizzle-orm/pg-core';
import { usersTable } from './users.schema.js';

export const referralsTable = pgTable('referrals', {
  id: uuid('id').defaultRandom().primaryKey(),
  referrerId: uuid('referrer_id').notNull().references(() => usersTable.id, { onDelete: 'cascade' }),
  refereeId: uuid('referee_id').notNull().references(() => usersTable.id, { onDelete: 'cascade' }),
  status: varchar('status', { length: 20 }).default('pending'),
  rewardAmount: integer('reward_amount').default(100),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
