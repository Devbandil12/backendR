// src/db/schema/rewards.schema.js
import {
  pgTable,
  uuid,
  integer,
  varchar,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { usersTable } from './users.schema.js';

export const rewardClaimsTable = pgTable('reward_claims', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => usersTable.id, { onDelete: 'cascade' }),
  taskType: varchar('task_type', { length: 50 }).notNull(),
  proof: text('proof').notNull(),
  status: varchar('status', { length: 20 }).default('pending'),
  rewardAmount: integer('reward_amount').notNull(),
  adminNote: text('admin_note'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const rewardConfigTable = pgTable('reward_config', {
  id: uuid('id').defaultRandom().primaryKey(),
  refereeBonus: integer('referee_bonus').default(50),
  referrerBonus: integer('referrer_bonus').default(50),
  paparazzi: integer('paparazzi').default(20),
  loyal_follower: integer('loyal_follower').default(20),
  reviewer: integer('reviewer').default(10),
  monthly_lottery: integer('monthly_lottery').default(100),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const lotteryLogsTable = pgTable('lottery_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  winnerId: uuid('winner_id').notNull().references(() => usersTable.id, { onDelete: 'cascade' }),
  actorId: uuid('actor_id').references(() => usersTable.id, { onDelete: 'set null' }), // The admin who picked
  rewardAmount: integer('reward_amount').notNull(),
  drawnAt: timestamp('drawn_at', { withTimezone: true }).defaultNow().notNull(),
});
