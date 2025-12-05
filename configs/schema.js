// file configs/schema.js

import { pgTable, serial, text, integer, uuid, varchar, PgSerial, timestamp, unique, boolean, index, jsonb, } from 'drizzle-orm/pg-core';
import { sql, relations } from 'drizzle-orm';

const generateNumericId = () => {
  const timestamp = Date.now();
  return `DA${timestamp}`;
};

export const usersTable = pgTable('users', {
  id: uuid("id").defaultRandom().primaryKey(),
  clerkId: text("clerk_id").notNull().unique(),
  name: text('name').notNull(),
  phone: text('phone').default(null),
  email: text('email').notNull().unique(),
  role: text('role').default('user'),
  profileImage: text('profile_image').default(null),
  dob: timestamp('dob', { withTimezone: true }).default(null),
  gender: text('gender').default(null),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  notify_order_updates: boolean('notify_order_updates').default(true).notNull(),
  notify_promos: boolean('notify_promos').default(true).notNull(),
  notify_pincode: boolean('notify_pincode').default(true).notNull()
});

export const usersRelations = relations(usersTable, ({ many }) => ({
  orders: many(ordersTable),
  addresses: many(UserAddressTable),
  reviews: many(reviewsTable),
  cartItems: many(addToCartTable),
  wishlistItems: many(wishlistTable),
  notifications: many(notificationsTable),
  savedItems: many(savedForLaterTable), 
}));


// 🟢 MODIFIED: This table now stores shared info
export const productsTable = pgTable('products', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  composition: varchar('composition', { length: 255 }).notNull(),
  description: varchar('description', { length: 255 }).notNull(),
  fragrance: varchar('fragrance', { length: 255 }).notNull(),
  fragranceNotes: varchar('fragranceNotes', { length: 255 }).notNull(),
  imageurl: jsonb("imageurl").notNull().default(sql`'{}'::jsonb`),
  category: varchar('category', { length: 100 }).default('Uncategorized'),
  isArchived: boolean('is_archived').default(false).notNull(),
});

// 🟢 NEW: This table stores purchasable items (SKUs)
export const productVariantsTable = pgTable('product_variants', {
  id: uuid('id').defaultRandom().primaryKey(),
  productId: uuid('product_id').notNull().references(() => productsTable.id, { onDelete: 'cascade' }),

  // Variant-specific details
  name: text('name').notNull(), // e.g., "20ml" or "Signature Combo"
  size: integer('size').notNull(),
  oprice: integer('oprice').notNull(),
  discount: integer('discount').notNull().default(0),
  costPrice: integer('cost_price').default(0),
  stock: integer("stock").notNull().default(0),
  sold: integer('sold').default(0),
  isArchived: boolean('is_archived').default(false).notNull(),
  sku: varchar('sku', { length: 100 }).unique(), // Optional, but good practice
});

// 🟢 NEW: This table links a "combo" variant to its "content" variants
export const productBundlesTable = pgTable('product_bundles', {
  id: uuid('id').defaultRandom().primaryKey(),

  // The "Combo" product variant
  bundleVariantId: uuid('bundle_variant_id').notNull().references(() => productVariantsTable.id, { onDelete: 'cascade' }),

  // The "content" product variant (e.g., one 20ml bottle)
  contentVariantId: uuid('content_variant_id').notNull().references(() => productVariantsTable.id, { onDelete: 'cascade' }),

  // How many of this content item are in the bundle
  quantity: integer('quantity').notNull().default(1),
});

// 🟢 MODIFIED: productsRelations
export const productsRelations = relations(productsTable, ({ many }) => ({
  reviews: many(reviewsTable), // Reviews are still for the main product
  orderItems: many(orderItemsTable),
  variants: many(productVariantsTable), // A product has many variants
}));

// 🟢 NEW: productVariantsRelations
export const productVariantsRelations = relations(productVariantsTable, ({ one, many }) => ({
  product: one(productsTable, { // A variant belongs to one product
    fields: [productVariantsTable.productId],
    references: [productsTable.id],
  }),
  bundleEntries: many(productBundlesTable, {
    relationName: 'bundleEntries',
    fields: [productVariantsTable.id],
    references: [productBundlesTable.bundleVariantId],
  }),
  bundleContents: many(productBundlesTable, {
    relationName: 'bundleContents',
    fields: [productVariantsTable.id],
    references: [productBundlesTable.contentVariantId],
  }),
}));

// 🟢 NEW: productBundlesRelations
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

// 🟢 MODIFIED: addToCartTable
export const addToCartTable = pgTable('add_to_cart', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  variantId: uuid('variant_id').notNull().references(() => productVariantsTable.id, { onDelete: "cascade" }),
  quantity: integer('quantity').notNull().default(1),
  addedAt: timestamp('added_at', { withTimezone: true }).defaultNow(),
});

export const addToCartRelations = relations(addToCartTable, ({ one }) => ({
  user: one(usersTable, {
    fields: [addToCartTable.userId],
    references: [usersTable.id],
  }),
  variant: one(productVariantsTable, {
    fields: [addToCartTable.variantId],
    references: [productVariantsTable.id],
  })
}));

// 🟢 MODIFIED: wishlistTable
export const wishlistTable = pgTable("wishlist_table", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  variantId: uuid("variant_id").notNull().references(() => productVariantsTable.id, { onDelete: "cascade" }),
  addedAt: timestamp("added_at", { withTimezone: true }).defaultNow(),
});

export const wishlistRelations = relations(wishlistTable, ({ one }) => ({
  user: one(usersTable, {
    fields: [wishlistTable.userId],
    references: [usersTable.id],
  }),
  variant: one(productVariantsTable, {
    fields: [wishlistTable.variantId],
    references: [productVariantsTable.id],
  }),
}));

// 🟢 NEW: Table for "Save for Later" items (distinct from Wishlist)
export const savedForLaterTable = pgTable('saved_for_later', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  variantId: uuid('variant_id').notNull().references(() => productVariantsTable.id, { onDelete: "cascade" }),
  quantity: integer('quantity').notNull().default(1), // Preserves the quantity from the cart
  addedAt: timestamp('added_at', { withTimezone: true }).defaultNow(),
});


// 🟢 NEW: Relations for savedForLaterTable
export const savedForLaterRelations = relations(savedForLaterTable, ({ one }) => ({
  user: one(usersTable, {
    fields: [savedForLaterTable.userId],
    references: [usersTable.id],
  }),
  variant: one(productVariantsTable, {
    fields: [savedForLaterTable.variantId],
    references: [productVariantsTable.id],
  })
}));

// 🟢 --- START: MODIFIED ordersTable ---
export const ordersTable = pgTable('orders', {
  id: text('id').primaryKey().$defaultFn(() => generateNumericId()),
  userId: uuid('user_id').notNull().references(() => usersTable.id),
  userAddressId: uuid('user_address_id').notNull().references(() => UserAddressTable.id),
  razorpay_order_id: text('razorpay_order_id'),
  totalAmount: integer('total_amount').notNull(),
  status: text('status').default('order placed'),
  progressStep: integer('progressStep').default(0),
  paymentMode: text('payment_mode').notNull(),
  transactionId: text('transaction_id').default("null"),
  paymentStatus: text("payment_status").default("pending"),
  phone: text("phone").notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  refund_id: text('refund_id'),
  refund_amount: integer('refund_amount'),
  refund_status: text('refund_status'),
  refund_speed: text('refund_speed'),
  refund_initiated_at: timestamp('refund_initiated_at'),
  refund_completed_at: timestamp('refund_completed_at'),

  // --- Discount Section ---
  couponCode: varchar('coupon_code', { length: 50 }), // For MANUAL coupons
  discountAmount: integer('discount_amount').default(0), // For MANUAL coupons

  // 🟢 NEW: Fields for automatic offers
  offerDiscount: integer('offer_discount').default(0), // The total discount from *automatic* offers
  offerCodes: jsonb('offer_codes'), // An array of applied offer names, e.g., ["FREE30ML", "10PERCENTOFF"]
});
// 🟢 --- END: MODIFIED ordersTable ---

export const ordersRelations = relations(ordersTable, ({ one, many }) => ({
  user: one(usersTable, {
    fields: [ordersTable.userId],
    references: [usersTable.id],
  }),
  address: one(UserAddressTable, {
    fields: [ordersTable.userAddressId],
    references: [UserAddressTable.id],
  }),
  orderItems: many(orderItemsTable),
}));

export const UserAddressTable = pgTable('user_address', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => usersTable.id, { onDelete: "cascade" }),
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
});

export const userAddressRelations = relations(UserAddressTable, ({ one }) => ({
  user: one(usersTable, {
    fields: [UserAddressTable.userId],
    references: [usersTable.id],
  }),
}));

export const pincodeServiceabilityTable = pgTable('pincode_serviceability', {
  pincode: varchar('pincode', { length: 6 }).primaryKey(),
  city: varchar('city', { length: 100 }).notNull(),
  state: varchar('state', { length: 100 }).notNull(),
  isServiceable: boolean('is_serviceable').default(false),
  codAvailable: boolean('cod_available').default(false),
  onlinePaymentAvailable: boolean('online_payment_available').default(true),
  deliveryCharge: integer('delivery_charge').default(50),
});

// 🟢 MODIFIED: orderItemsTable
export const orderItemsTable = pgTable('order_items', {
  id: text('id').primaryKey().$defaultFn(() => generateNumericId()),
  orderId: text('order_id').notNull().references(() => ordersTable.id, { onDelete: "cascade" }),
  productName: varchar('product_name', { length: 255 }).notNull(),
  img: varchar('img', { length: 500 }).notNull(),
  variantId: uuid('variant_id').notNull().references(() => productVariantsTable.id), // No cascade, protect history
  productId: uuid('product_id').notNull().references(() => productsTable.id), // Keep this to link to the main product page
  quantity: integer('quantity').notNull().default(1),
  price: integer('price').notNull(), // This is the price *at the time of purchase*
  totalPrice: integer('total_price').notNull(),
  size: integer('size').notNull().default(0),
});

export const orderItemsRelations = relations(orderItemsTable, ({ one }) => ({
  order: one(ordersTable, {
    fields: [orderItemsTable.orderId],
    references: [ordersTable.id],
  }),
  variant: one(productVariantsTable, {
    fields: [orderItemsTable.variantId],
    references: [productVariantsTable.id],
  }),
  product: one(productsTable, {
    fields: [orderItemsTable.productId],
    references: [productsTable.id],
  }),
}));

// 🟢 --- START: MODIFIED couponsTable ---
export const couponsTable = pgTable('coupons', {
  id: serial('id').primaryKey(),
  code: varchar('code', { length: 50 }).notNull().unique(),
  description: text('description'),

  // --- Main Action ---
  discountType: varchar('discount_type', { length: 20 }).notNull(), // 'percent', 'flat', 'free_item'
  discountValue: integer('discount_value').notNull().default(0),

  // --- Basic Rules ---
  minOrderValue: integer('min_order_value').default(0),
  minItemCount: integer('min_item_count').default(0),
  maxDiscountAmount: integer('max_discount_amount'),
  validFrom: timestamp('valid_from'),
  validUntil: timestamp('valid_until'),
  firstOrderOnly: boolean('is_first_order_only').default(false),
  maxUsagePerUser: integer('max_usage_per_user').default(1),

  // --- 🟢 NEW: Automatic Offer Rules ---

  isAutomatic: boolean('is_automatic').default(false).notNull(),
  cond_requiredCategory: varchar('cond_required_category', { length: 100 }),
  action_targetSize: integer('action_target_size'),
  action_targetMaxPrice: integer('action_target_max_price'),
  cond_requiredSize: integer('cond_required_size'),
  action_buyX: integer('action_buy_x'),
  action_getY: integer('action_get_y'),
});

export const testimonials = pgTable("testimonials", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  title: text("title"),
  text: text("text").notNull(),
  rating: integer("rating").notNull(),
  avatar: text("avatar"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// 🟢 MODIFIED: reviewsTable
export const reviewsTable = pgTable('product_reviews', {
  id: uuid('id').defaultRandom().primaryKey(),
  productId: uuid('product_id').notNull().references(() => productsTable.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => usersTable.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  rating: integer('rating').notNull(),
  comment: text('comment').notNull(),
  photoUrls: text('photo_urls').array(),
  isVerifiedBuyer: boolean('is_verified_buyer').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  productIdIdx: index('idx_reviews_product_id').on(table.productId),
  ratingIdx: index('idx_reviews_rating').on(table.rating),
  createdAtIdx: index('idx_reviews_created_at').on(table.createdAt),
}));

export const reviewsRelations = relations(reviewsTable, ({ one }) => ({
  product: one(productsTable, {
    fields: [reviewsTable.productId],
    references: [productsTable.id],
  }),
  user: one(usersTable, {
    fields: [reviewsTable.userId],
    references: [usersTable.id],
  }),
}));


export const notificationsTable = pgTable('notifications', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  message: text('message').notNull(),
  link: text('link'), // e.g., /myorder/DA123456
  isRead: boolean('is_read').default(false).notNull(),
  type: varchar('type', { length: 50 }).default('general'), // e.g., 'order', 'coupon', 'system'
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  userIdIdx: index('idx_notifications_user_id').on(table.userId),
}));

export const notificationsRelations = relations(notificationsTable, ({ one }) => ({
  user: one(usersTable, {
    fields: [notificationsTable.userId],
    references: [usersTable.id],
  }),
}));


const generateTicketId = () => {
  return `SUP-${Date.now()}`;
};
// 🟢 MODIFIED: Tickets Table with Readable ID
export const ticketsTable = pgTable("tickets", {
  id: text("id").primaryKey().$defaultFn(() => generateTicketId()), // Changed from UUID to Text with Generator
  userId: uuid("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  guestEmail: text("guest_email"), 
  guestPhone: text("guest_phone"),
  subject: text("subject").notNull().default("Support Query"),
  status: varchar("status", { length: 20 }).default("open").notNull(), 
  priority: varchar("priority", { length: 20 }).default("medium"),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// 🟢 MODIFIED: Messages Table (ticketId type changed to text)
export const ticketMessagesTable = pgTable("ticket_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  ticketId: text("ticket_id").notNull().references(() => ticketsTable.id, { onDelete: "cascade" }), // Must match ticketsTable.id type
  senderRole: varchar("sender_role", { length: 20 }).notNull(),
  message: text("message").notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// Relations (Keep as is)
export const ticketsRelations = relations(ticketsTable, ({ one, many }) => ({
  user: one(usersTable, {
    fields: [ticketsTable.userId],
    references: [usersTable.id],
  }),
  messages: many(ticketMessagesTable),
}));

export const ticketMessagesRelations = relations(ticketMessagesTable, ({ one }) => ({
  ticket: one(ticketsTable, {
    fields: [ticketMessagesTable.ticketId],
    references: [ticketsTable.id],
  }),
}));


export const activityLogsTable = pgTable('activity_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  
  // 🟢 CHANGE: This now represents the ACTOR (Who performed the action)
  userId: uuid('user_id').references(() => usersTable.id, { onDelete: 'cascade' }),
  
  // 🟢 NEW: This represents the TARGET (Who was changed)
  targetId: uuid('target_id').references(() => usersTable.id, { onDelete: 'set null' }),

  action: varchar('action', { length: 50 }).notNull(),
  description: text('description'),
  metadata: jsonb('metadata'),
  
  // We can keep this for redundancy or remove it, but let's keep it for easy UI display
  performedBy: varchar('performed_by', { length: 20 }).default('user'), 
  
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// Add relations
export const activityLogsRelations = relations(activityLogsTable, ({ one }) => ({
  actor: one(usersTable, {
    fields: [activityLogsTable.userId],
    references: [usersTable.id],
    relationName: "actorLogs"
  }),
  target: one(usersTable, {
    fields: [activityLogsTable.targetId],
    references: [usersTable.id],
    relationName: "targetLogs"
  }),
}));