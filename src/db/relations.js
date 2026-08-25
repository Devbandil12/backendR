// src/db/relations.js
// All Drizzle ORM relations — kept separate from table definitions.

import { relations } from 'drizzle-orm';

import { usersTable, UserAddressTable, walletTransactionsTable } from './schema/users.schema.js';
import { productsTable } from './schema/products.schema.js';
import { productVariantsTable } from './schema/variants.schema.js';
import { productBundlesTable } from './schema/bundles.schema.js';
import { addToCartTable, savedForLaterTable } from './schema/cart.schema.js';
import { wishlistTable } from './schema/wishlist.schema.js';
import { ordersTable, orderItemsTable, orderTimeline } from './schema/orders.schema.js';
import { orderNotesTable } from './schema/orderNotes.schema.js';
import { returnsTable, returnItemsTable, refundsTable } from './schema/returns.schema.js';
import { couponsTable } from './schema/coupons.schema.js';
import { reviewsTable } from './schema/reviews.schema.js';
import { notificationsTable } from './schema/notifications.schema.js';
import { referralsTable } from './schema/referrals.schema.js';
import { rewardClaimsTable } from './schema/rewards.schema.js';
import {
  ticketsTable,
  ticketMessagesTable,
  ticketEventsTable,
  ticketAttachmentsTable,
  auditLogsTable,
  supportTeamsTable,
  supportCsatTable,
} from './schema/audit.schema.js';

// ── Users ─────────────────────────────────────────────────────────────────────
export const usersRelations = relations(usersTable, ({ many, one }) => ({
  orders: many(ordersTable),
  addresses: many(UserAddressTable),
  reviews: many(reviewsTable),
  cartItems: many(addToCartTable),
  wishlistItems: many(wishlistTable),
  notifications: many(notificationsTable),
  savedItems: many(savedForLaterTable),
  walletTransactions: many(walletTransactionsTable),
  referralsMade: many(referralsTable, { relationName: 'referrer_relation' }),
  referredByRelation: one(usersTable, {
    fields: [usersTable.referredBy],
    references: [usersTable.id],
    relationName: 'referralChain',
    userClaims: many(rewardClaimsTable),
  }),
}));

export const userAddressRelations = relations(UserAddressTable, ({ one }) => ({
  user: one(usersTable, {
    fields: [UserAddressTable.userId],
    references: [usersTable.id],
  }),
}));

export const walletTransactionsRelations = relations(walletTransactionsTable, ({ one }) => ({
  user: one(usersTable, {
    fields: [walletTransactionsTable.userId],
    references: [usersTable.id],
  }),
}));

// ── Referrals & Rewards ────────────────────────────────────────────────────────
export const referralsRelations = relations(referralsTable, ({ one }) => ({
  referrer: one(usersTable, {
    fields: [referralsTable.referrerId],
    references: [usersTable.id],
    relationName: 'referrer_relation',
  }),
  referee: one(usersTable, {
    fields: [referralsTable.refereeId],
    references: [usersTable.id],
  }),
}));

export const rewardClaimsRelations = relations(rewardClaimsTable, ({ one }) => ({
  user: one(usersTable, {
    fields: [rewardClaimsTable.userId],
    references: [usersTable.id],
  }),
}));

// ── Products & Variants ────────────────────────────────────────────────────────
export const productsRelations = relations(productsTable, ({ many }) => ({
  reviews: many(reviewsTable),
  orderItems: many(orderItemsTable),
  variants: many(productVariantsTable),
}));

export const productVariantsRelations = relations(productVariantsTable, ({ one, many }) => ({
  product: one(productsTable, {
    fields: [productVariantsTable.productId],
    references: [productsTable.id],
  }),
  bundleEntries: many(productBundlesTable, { relationName: 'bundleEntries' }),
  bundleContents: many(productBundlesTable, { relationName: 'bundleContents' }),
}));

export const productBundlesRelations = relations(productBundlesTable, ({ one }) => ({
  bundle: one(productVariantsTable, {
    fields: [productBundlesTable.bundleVariantId],
    references: [productVariantsTable.id],
    relationName: 'bundleEntries',
  }),
  content: one(productVariantsTable, {
    fields: [productBundlesTable.contentVariantId],
    references: [productVariantsTable.id],
    relationName: 'bundleContents',
  }),
}));

// ── Cart, Wishlist & Saved For Later ──────────────────────────────────────────
export const addToCartRelations = relations(addToCartTable, ({ one }) => ({
  user: one(usersTable, { fields: [addToCartTable.userId], references: [usersTable.id] }),
  variant: one(productVariantsTable, { fields: [addToCartTable.variantId], references: [productVariantsTable.id] }),
}));

export const wishlistRelations = relations(wishlistTable, ({ one }) => ({
  user: one(usersTable, { fields: [wishlistTable.userId], references: [usersTable.id] }),
  variant: one(productVariantsTable, { fields: [wishlistTable.variantId], references: [productVariantsTable.id] }),
}));

export const savedForLaterRelations = relations(savedForLaterTable, ({ one }) => ({
  user: one(usersTable, { fields: [savedForLaterTable.userId], references: [usersTable.id] }),
  variant: one(productVariantsTable, { fields: [savedForLaterTable.variantId], references: [productVariantsTable.id] }),
}));

// ── Orders ────────────────────────────────────────────────────────────────────
export const ordersRelations = relations(ordersTable, ({ one, many }) => ({
  user: one(usersTable, { fields: [ordersTable.userId], references: [usersTable.id] }),
  address: one(UserAddressTable, { fields: [ordersTable.userAddressId], references: [UserAddressTable.id] }),
  orderItems: many(orderItemsTable),
  timeline: many(orderTimeline),
  notes: many(orderNotesTable),
  returns: many(returnsTable),
  refunds: many(refundsTable),
}));

export const orderItemsRelations = relations(orderItemsTable, ({ one }) => ({
  order: one(ordersTable, { fields: [orderItemsTable.orderId], references: [ordersTable.id] }),
  variant: one(productVariantsTable, { fields: [orderItemsTable.variantId], references: [productVariantsTable.id] }),
  product: one(productsTable, { fields: [orderItemsTable.productId], references: [productsTable.id] }),
}));

export const orderTimelineRelations = relations(orderTimeline, ({ one }) => ({
  order: one(ordersTable, { fields: [orderTimeline.orderId], references: [ordersTable.id] }),
}));

// ── Order Notes ───────────────────────────────────────────────────────────────
export const orderNotesRelations = relations(orderNotesTable, ({ one }) => ({
  order: one(ordersTable, { fields: [orderNotesTable.orderId], references: [ordersTable.id] }),
  admin: one(usersTable, { fields: [orderNotesTable.adminId], references: [usersTable.id] }),
}));

// ── Returns & Refunds ─────────────────────────────────────────────────────────
export const returnsRelations = relations(returnsTable, ({ one, many }) => ({
  order: one(ordersTable, { fields: [returnsTable.orderId], references: [ordersTable.id] }),
  user: one(usersTable, { fields: [returnsTable.userId], references: [usersTable.id] }),
  returnItems: many(returnItemsTable),
  refunds: many(refundsTable),
}));

export const returnItemsRelations = relations(returnItemsTable, ({ one }) => ({
  returnRecord: one(returnsTable, { fields: [returnItemsTable.returnId], references: [returnsTable.id] }),
  orderItem: one(orderItemsTable, { fields: [returnItemsTable.orderItemId], references: [orderItemsTable.id] }),
}));

export const refundsRelations = relations(refundsTable, ({ one }) => ({
  order: one(ordersTable, { fields: [refundsTable.orderId], references: [ordersTable.id] }),
  returnRecord: one(returnsTable, { fields: [refundsTable.returnId], references: [returnsTable.id] }),
}));

// ── Coupons ───────────────────────────────────────────────────────────────────
export const couponsRelations = relations(couponsTable, ({ one }) => ({
  targetUser: one(usersTable, { fields: [couponsTable.targetUserId], references: [usersTable.id] }),
}));

// ── Reviews ───────────────────────────────────────────────────────────────────
export const reviewsRelations = relations(reviewsTable, ({ one }) => ({
  product: one(productsTable, { fields: [reviewsTable.productId], references: [productsTable.id] }),
  user: one(usersTable, { fields: [reviewsTable.userId], references: [usersTable.id] }),
}));

// ── Notifications ─────────────────────────────────────────────────────────────
export const notificationsRelations = relations(notificationsTable, ({ one }) => ({
  user: one(usersTable, { fields: [notificationsTable.userId], references: [usersTable.id] }),
}));

// ── Support Tickets ───────────────────────────────────────────────────────────
export const ticketsRelations = relations(ticketsTable, ({ one, many }) => ({
  user: one(usersTable, {
    fields: [ticketsTable.userId],
    references: [usersTable.id],
    relationName: 'ticketUser',
  }),
  assignedAgent: one(usersTable, {
    fields: [ticketsTable.assignedAgentId],
    references: [usersTable.id],
    relationName: 'ticketAgent',
  }),
  assignedTeam: one(supportTeamsTable, {
    fields: [ticketsTable.assignedTeamId],
    references: [supportTeamsTable.id],
  }),
  messages: many(ticketMessagesTable),
  events: many(ticketEventsTable),
  attachments: many(ticketAttachmentsTable),
  supportCsat: one(supportCsatTable),
}));

export const ticketMessagesRelations = relations(ticketMessagesTable, ({ one, many }) => ({
  ticket: one(ticketsTable, { fields: [ticketMessagesTable.ticketId], references: [ticketsTable.id] }),
  sender: one(usersTable, { fields: [ticketMessagesTable.senderId], references: [usersTable.id] }),
  attachments: many(ticketAttachmentsTable),
}));

export const ticketEventsRelations = relations(ticketEventsTable, ({ one }) => ({
  ticket: one(ticketsTable, { fields: [ticketEventsTable.ticketId], references: [ticketsTable.id] }),
  actor: one(usersTable, { fields: [ticketEventsTable.actorId], references: [usersTable.id] }),
}));

export const ticketAttachmentsRelations = relations(ticketAttachmentsTable, ({ one }) => ({
  ticket: one(ticketsTable, { fields: [ticketAttachmentsTable.ticketId], references: [ticketsTable.id] }),
  message: one(ticketMessagesTable, { fields: [ticketAttachmentsTable.messageId], references: [ticketMessagesTable.id] }),
  uploader: one(usersTable, { fields: [ticketAttachmentsTable.uploadedByUserId], references: [usersTable.id] }),
}));

export const supportCsatRelations = relations(supportCsatTable, ({ one }) => ({
  ticket: one(ticketsTable, { fields: [supportCsatTable.ticketId], references: [ticketsTable.id] }),
  user: one(usersTable, { fields: [supportCsatTable.userId], references: [usersTable.id] }),
}));

export const supportTeamsRelations = relations(supportTeamsTable, ({ many }) => ({
  tickets: many(ticketsTable),
}));

// ── Audit Logs ─────────────────────────────────────────────────────────────
export const auditLogsRelations = relations(auditLogsTable, ({ one }) => ({
  actor: one(usersTable, {
    fields: [auditLogsTable.actorUserId],
    references: [usersTable.id],
    relationName: 'actorAuditLogs',
  }),
}));
