// src/db/schema/audit.schema.js
// Enterprise Support Platform — Schema
// Tables: audit_logs, support_teams, support_tags, tickets, ticket_messages, ticket_events, ticket_attachments

import {
  pgTable,
  uuid,
  text,
  varchar,
  timestamp,
  jsonb,
  integer,
  boolean,
  index,
  uniqueIndex,
  unique,
  serial,
} from 'drizzle-orm/pg-core';
import { usersTable } from './users.schema.js';

// ── Audit Logs (Centralized Security & Audit System) ─────────────────────────
export const auditLogsTable = pgTable('audit_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  
  // Actor context
  actorUserId: uuid('actor_user_id').references(() => usersTable.id, { onDelete: 'set null' }),
  actorType: varchar('actor_type', { length: 20 }).notNull(), // USER, ADMIN, SUPER_ADMIN, SYSTEM, AUTOMATION, WORKER
  actorRole: varchar('actor_role', { length: 50 }),
  
  // Event categorization
  action: varchar('action', { length: 100 }).notNull(),
  category: varchar('category', { length: 50 }).notNull(),
  severity: varchar('severity', { length: 20 }).notNull(), // INFO, WARNING, HIGH, CRITICAL
  
  // Resource context
  resourceType: varchar('resource_type', { length: 50 }),
  resourceId: varchar('resource_id', { length: 100 }),
  resourceDisplayName: text('resource_display_name'),
  resourceDisplaySubtitle: text('resource_display_subtitle'),
  
  // Event details
  description: text('description'),
  before: jsonb('before'),
  after: jsonb('after'),
  changes: jsonb('changes'),
  metadata: jsonb('metadata'),
  
  // Request & security context
  requestId: varchar('request_id', { length: 100 }),
  ipAddress: varchar('ip_address', { length: 45 }), // Supports IPv6
  userAgent: text('user_agent'),
  
  // Outcome
  status: varchar('status', { length: 20 }).notNull(), // SUCCESS, FAILED, DENIED
  failureReason: text('failure_reason'),
  
  // Timing
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  createdAtIdx: index('audit_logs_created_at_idx').on(table.createdAt.desc()),
  actorUserCreatedAtIdx: index('audit_logs_actor_created_idx').on(table.actorUserId, table.createdAt.desc()),
  categoryCreatedAtIdx: index('audit_logs_category_created_idx').on(table.category, table.createdAt.desc()),
  actionCreatedAtIdx: index('audit_logs_action_created_idx').on(table.action, table.createdAt.desc()),
  resourceIdx: index('audit_logs_resource_idx').on(table.resourceType, table.resourceId),
  statusCreatedAtIdx: index('audit_logs_status_created_idx').on(table.status, table.createdAt.desc()),
  requestIdIdx: index('audit_logs_request_id_idx').on(table.requestId),
}));

// ── Support Teams ─────────────────────────────────────────────────────────────
export const supportTeamsTable = pgTable('support_teams', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  description: text('description'),
  color: varchar('color', { length: 20 }).default('#6B7280'),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ── Support Tags ──────────────────────────────────────────────────────────────
export const supportTagsTable = pgTable('support_tags', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 50 }).notNull().unique(),
  color: varchar('color', { length: 20 }).default('#6B7280'),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ── Ticket Number Counter ─────────────────────────────────────────────────────
export const ticketCounterTable = pgTable('ticket_counter', {
  id: serial('id').primaryKey(),
  year: integer('year').notNull(),
  lastNumber: integer('last_number').notNull().default(0),
});

// ── Tickets ───────────────────────────────────────────────────────────────────
// Status lifecycle: NEW → OPEN → IN_PROGRESS → WAITING_FOR_CUSTOMER → PENDING → RESOLVED → CLOSED
//                   Can also: REOPENED, SPAM
// Priority: LOW | NORMAL | HIGH | URGENT | CRITICAL
// Category: orders, payments, shipping, products, account, offers, other
export const ticketsTable = pgTable('tickets', {
  // Internal UUID primary key
  id: uuid('id').defaultRandom().primaryKey(),

  // Human-readable ticket number: SUP-2026-000001
  ticketNumber: text('ticket_number').notNull().unique(),

  // Customer identity
  userId: uuid('user_id').references(() => usersTable.id, { onDelete: 'set null' }),
  guestEmail: text('guest_email'),
  guestPhone: text('guest_phone'),
  guestName: text('guest_name'),

  // Ticket content
  subject: text('subject').notNull().default('Support Query'),
  channel: varchar('channel', { length: 20 }).default('web').notNull(), // web, email, whatsapp, phone

  // Lifecycle
  status: varchar('status', { length: 30 }).default('new').notNull(),
  priority: varchar('priority', { length: 20 }).default('normal').notNull(),

  // Classification
  category: varchar('category', { length: 50 }),
  subcategory: varchar('subcategory', { length: 50 }),
  tags: jsonb('tags').default([]),

  // Assignment
  assignedAgentId: uuid('assigned_agent_id').references(() => usersTable.id, { onDelete: 'set null' }),
  assignedTeamId: uuid('assigned_team_id').references(() => supportTeamsTable.id, { onDelete: 'set null' }),

  // Related entities (order linking)
  relatedOrderId: text('related_order_id'),
  relatedPaymentId: text('related_payment_id'),
  relatedShipmentId: text('related_shipment_id'),

  // SLA timestamps
  firstResponseAt: timestamp('first_response_at', { withTimezone: true }),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  firstResponseDueAt: timestamp('first_response_due_at', { withTimezone: true }),
  resolutionDueAt: timestamp('resolution_due_at', { withTimezone: true }),
  isFirstResponseBreached: boolean('is_first_response_breached').default(false).notNull(),
  isResolutionBreached: boolean('is_resolution_breached').default(false).notNull(),

  // Soft delete / archival
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),

  // Timestamps
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  statusIdx: index('tickets_status_idx').on(table.status),
  priorityIdx: index('tickets_priority_idx').on(table.priority),
  assignedAgentIdx: index('tickets_assigned_agent_idx').on(table.assignedAgentId),
  assignedTeamIdx: index('tickets_assigned_team_idx').on(table.assignedTeamId),
  categoryIdx: index('tickets_category_idx').on(table.category),
  userIdIdx: index('tickets_user_id_idx').on(table.userId),
  guestEmailIdx: index('tickets_guest_email_idx').on(table.guestEmail),
  createdAtIdx: index('tickets_created_at_idx').on(table.createdAt),
  updatedAtIdx: index('tickets_updated_at_idx').on(table.updatedAt),
  ticketNumberIdx: index('tickets_ticket_number_idx').on(table.ticketNumber),
  firstResponseDueIdx: index('tickets_first_response_due_idx').on(table.firstResponseDueAt),
  resolutionDueIdx: index('tickets_resolution_due_idx').on(table.resolutionDueAt),
  isFirstResponseBreachedIdx: index('tickets_is_first_response_breached_idx').on(table.isFirstResponseBreached),
  isResolutionBreachedIdx: index('tickets_is_resolution_breached_idx').on(table.isResolutionBreached),
}));

// ── Ticket Messages ───────────────────────────────────────────────────────────
// messageType: customer | agent | internal_note | system_event
export const ticketMessagesTable = pgTable('ticket_messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  ticketId: uuid('ticket_id').notNull().references(() => ticketsTable.id, { onDelete: 'cascade' }),
  senderRole: varchar('sender_role', { length: 20 }).notNull(), // user, admin (kept for backward compat display)
  senderId: uuid('sender_id').references(() => usersTable.id, { onDelete: 'set null' }),
  messageType: varchar('message_type', { length: 20 }).notNull().default('customer'), // customer, agent, internal_note, system_event
  message: text('message').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  ticketIdIdx: index('ticket_messages_ticket_id_idx').on(table.ticketId),
  createdAtIdx: index('ticket_messages_created_at_idx').on(table.createdAt),
  messageTypeIdx: index('ticket_messages_message_type_idx').on(table.messageType),
}));

// ── Ticket Events (Audit Trail) ───────────────────────────────────────────────
// Event types: TICKET_CREATED, STATUS_CHANGED, PRIORITY_CHANGED, ASSIGNED,
//              UNASSIGNED, TEAM_CHANGED, MESSAGE_ADDED, NOTE_ADDED,
//              TAG_ADDED, TAG_REMOVED, ATTACHMENT_ADDED, ARCHIVED, RESTORED
export const ticketEventsTable = pgTable('ticket_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  ticketId: uuid('ticket_id').notNull().references(() => ticketsTable.id, { onDelete: 'cascade' }),
  actorId: uuid('actor_id').references(() => usersTable.id, { onDelete: 'set null' }),
  actorRole: varchar('actor_role', { length: 20 }), // user, admin, system
  eventType: varchar('event_type', { length: 40 }).notNull(),
  fromValue: text('from_value'),
  toValue: text('to_value'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  ticketIdIdx: index('ticket_events_ticket_id_idx').on(table.ticketId),
  createdAtIdx: index('ticket_events_created_at_idx').on(table.createdAt),
  eventTypeIdx: index('ticket_events_event_type_idx').on(table.eventType),
}));

// ── Ticket Attachments ────────────────────────────────────────────────────────
export const ticketAttachmentsTable = pgTable('ticket_attachments', {
  id: uuid('id').defaultRandom().primaryKey(),
  ticketId: uuid('ticket_id').notNull().references(() => ticketsTable.id, { onDelete: 'cascade' }),
  messageId: uuid('message_id').references(() => ticketMessagesTable.id, { onDelete: 'set null' }),
  uploadedByUserId: uuid('uploaded_by_user_id').references(() => usersTable.id, { onDelete: 'set null' }),
  uploadedByRole: varchar('uploaded_by_role', { length: 20 }).notNull(), // user, admin
  originalName: text('original_name').notNull(),
  mimeType: varchar('mime_type', { length: 100 }).notNull(),
  size: integer('size').notNull(), // bytes
  storageKey: text('storage_key').notNull(), // relative path or S3 key
  url: text('url').notNull(), // public access URL
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  ticketIdIdx: index('ticket_attachments_ticket_id_idx').on(table.ticketId),
  messageIdIdx: index('ticket_attachments_message_id_idx').on(table.messageId),
}));

// ── Support CSAT Feedback ─────────────────────────────────────────────────────
export const supportCsatTable = pgTable('support_csat', {
  id: uuid('id').defaultRandom().primaryKey(),
  ticketId: uuid('ticket_id').notNull().unique().references(() => ticketsTable.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => usersTable.id, { onDelete: 'set null' }),
  rating: integer('rating').notNull(), // 1 to 5
  comment: text('comment'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  ticketIdIdx: index('support_csat_ticket_id_idx').on(table.ticketId),
  ratingIdx: index('support_csat_rating_idx').on(table.rating),
}));

// ── Support Canned Responses ──────────────────────────────────────────────────
export const supportCannedResponsesTable = pgTable('support_canned_responses', {
  id: uuid('id').defaultRandom().primaryKey(),
  shortcut: varchar('shortcut', { length: 50 }).notNull(),
  title: varchar('title', { length: 100 }).notNull(),
  content: text('content').notNull(),
  scope: varchar('scope', { length: 20 }).default('GLOBAL').notNull(), // GLOBAL or PERSONAL
  createdBy: uuid('created_by').references(() => usersTable.id, { onDelete: 'cascade' }),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  shortcutIdx: index('support_canned_responses_shortcut_idx').on(table.shortcut),
  uniqueShortcut: unique('unique_canned_response_shortcut').on(table.shortcut, table.scope, table.createdBy)
}));
