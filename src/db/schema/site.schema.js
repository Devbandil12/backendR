import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  jsonb
} from 'drizzle-orm/pg-core';
import { usersTable } from './users.schema.js';

// ── Site Settings ─────────────────────────────────────────────────────────────
// Single row configuration for the site status
export const siteSettingsTable = pgTable('site_settings', {
  id: uuid('id').defaultRandom().primaryKey(),
  mode: text('mode').default('LIVE').notNull(), // LIVE, COMING_SOON, MAINTENANCE, EMERGENCY
  scheduledStart: timestamp('scheduled_start', { withTimezone: true }),
  scheduledEnd: timestamp('scheduled_end', { withTimezone: true }),
  title: text('title'),
  message: text('message'),
  showCountdown: boolean('show_countdown').default(false).notNull(),
  bypassEnabled: boolean('bypass_enabled').default(true).notNull(), // Admins can bypass
  updatedBy: uuid('updated_by').references(() => usersTable.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// ── Site Status Logs ──────────────────────────────────────────────────────────
// Audit trail for site status changes
export const siteStatusLogsTable = pgTable('site_status_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  oldMode: text('old_mode').notNull(),
  newMode: text('new_mode').notNull(),
  reason: text('reason'),
  updatedBy: uuid('updated_by').references(() => usersTable.id, { onDelete: 'set null' }),
  requestId: text('request_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// ── Global Announcements ──────────────────────────────────────────────────────
export const globalAnnouncementsTable = pgTable('global_announcements', {
  id: uuid('id').defaultRandom().primaryKey(),
  title: text('title').notNull(),
  message: text('message').notNull(),
  type: text('type').default('INFO').notNull(), // INFO, SUCCESS, PROMOTION, WARNING, MAINTENANCE, EMERGENCY
  severity: text('severity').default('Low').notNull(), // Low, Medium, High, Critical
  startAt: timestamp('start_at', { withTimezone: true }),
  endAt: timestamp('end_at', { withTimezone: true }),
  audience: text('audience').default('Everyone').notNull(),
  channels: jsonb('channels').default(['Website Banner']).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdBy: uuid('created_by').references(() => usersTable.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
