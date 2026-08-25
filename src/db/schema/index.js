// src/db/schema/index.js
// Barrel — re-exports every table from all domain schema files.
// Import from here whenever you need the full schema (e.g. drizzle client, relations).

export * from './users.schema.js';
export * from './products.schema.js';
export * from './variants.schema.js';
export * from './bundles.schema.js';
export * from './cart.schema.js';
export * from './wishlist.schema.js';
export * from './orders.schema.js';
export * from './payments.schema.js';
export * from './coupons.schema.js';
export * from './reviews.schema.js';
export * from './addresses.schema.js';
export * from './notifications.schema.js';
export * from './referrals.schema.js';
export * from './rewards.schema.js';
export * from './cms.schema.js';
export * from './shipping.schema.js';
export * from './audit.schema.js';
export * from './outbox.schema.js';
export * from './rbac.schema.js';
export * from './analytics.schema.js';
export * from './site.schema.js';
export * from './knowledge.schema.js';
export * from './returns.schema.js';
export * from './orderNotes.schema.js';
export * from './waitlist.schema.js';
