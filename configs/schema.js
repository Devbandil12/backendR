// file: configs/schema.js

import { pgTable, serial, text, integer, uuid, varchar, PgSerial, timestamp, unique, boolean, index, jsonb, } from 'drizzle-orm/pg-core';
import { sql, relations } from 'drizzle-orm';

const generateNumericId = () => {
  const timestamp = Date.now();
  return `DA${timestamp}`;
};

const generateTicketId = () => `SUP-${Date.now()}`;


// =========================================
// 1. DEFINE ALL TABLES FIRST
// =========================================

// 1. Users Table
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
  notify_pincode: boolean('notify_pincode').default(true).notNull(),
  pushSubscription: jsonb('push_subscription'),
  referralCode: text('referral_code').unique(),
  referredBy: uuid('referred_by'),
  walletBalance: integer('wallet_balance').default(0).notNull(),
});

// 2. User Address Table
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

// 3. Wallet Transactions Table
export const walletTransactionsTable = pgTable('wallet_transactions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => usersTable.id, { onDelete: 'cascade' }),
  amount: integer('amount').notNull(),
  type: varchar('type', { length: 50 }).notNull(),
  description: text('description').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});


// 4. Referrals Table
export const referralsTable = pgTable('referrals', {
  id: uuid('id').defaultRandom().primaryKey(),
  referrerId: uuid('referrer_id').notNull().references(() => usersTable.id, { onDelete: 'cascade' }),
  refereeId: uuid('referee_id').notNull().references(() => usersTable.id, { onDelete: 'cascade' }),
  status: varchar('status', { length: 20 }).default('pending'), // 'pending', 'completed'
  rewardAmount: integer('reward_amount').default(100),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// 5. Reward Claims Table
export const rewardClaimsTable = pgTable('reward_claims', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => usersTable.id, { onDelete: 'cascade' }),
  taskType: varchar('task_type', { length: 50 }).notNull(), // 'paparazzi', 'follower', 'reviewer'
  proof: text('proof').notNull(), // URL to image OR text
  status: varchar('status', { length: 20 }).default('pending'), // 'pending', 'approved', 'rejected'
  rewardAmount: integer('reward_amount').notNull(),
  adminNote: text('admin_note'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const rewardConfigTable = pgTable("reward_config", {
  id: uuid("id").defaultRandom().primaryKey(),
  
  // Referral Settings
  refereeBonus: integer("referee_bonus").default(50), // Friend Gets
  referrerBonus: integer("referrer_bonus").default(50), // You Get
  
  // Task Reward Settings
  paparazzi: integer("paparazzi").default(20),
  loyal_follower: integer("loyal_follower").default(20),
  reviewer: integer("reviewer").default(10),
  monthly_lottery: integer("monthly_lottery").default(100),
  
  updatedAt: timestamp("updated_at").defaultNow(),
});

// --- PRODUCTS & VARIANTS ---
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


export const productVariantsTable = pgTable('product_variants', {
  id: uuid('id').defaultRandom().primaryKey(),
  productId: uuid('product_id').notNull().references(() => productsTable.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  size: integer('size').notNull(),
  oprice: integer('oprice').notNull(),
  discount: integer('discount').notNull().default(0),
  costPrice: integer('cost_price').default(0),
  stock: integer("stock").notNull().default(0),
  sold: integer('sold').default(0),
  isArchived: boolean('is_archived').default(false).notNull(),
  sku: varchar('sku', { length: 100 }).unique(),
});


export const productBundlesTable = pgTable('product_bundles', {
  id: uuid('id').defaultRandom().primaryKey(),
  bundleVariantId: uuid('bundle_variant_id').notNull().references(() => productVariantsTable.id, { onDelete: 'cascade' }),
  contentVariantId: uuid('content_variant_id').notNull().references(() => productVariantsTable.id, { onDelete: 'cascade' }),
  quantity: integer('quantity').notNull().default(1),
});


// --- CART, WISHLIST & SAVED FOR LATER ---

export const addToCartTable = pgTable('add_to_cart', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  variantId: uuid('variant_id').notNull().references(() => productVariantsTable.id, { onDelete: "cascade" }),
  quantity: integer('quantity').notNull().default(1),
  addedAt: timestamp('added_at', { withTimezone: true }).defaultNow(),
});

export const wishlistTable = pgTable("wishlist_table", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  variantId: uuid("variant_id").notNull().references(() => productVariantsTable.id, { onDelete: "cascade" }),
  addedAt: timestamp("added_at", { withTimezone: true }).defaultNow(),
});

export const savedForLaterTable = pgTable('saved_for_later', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  variantId: uuid('variant_id').notNull().references(() => productVariantsTable.id, { onDelete: "cascade" }),
  quantity: integer('quantity').notNull().default(1),
  addedAt: timestamp('added_at', { withTimezone: true }).defaultNow(),
});

// --- ORDERS & ORDER ITEMS ---

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
  walletAmountUsed: integer('wallet_amount_used').default(0),

  // Coupons & Offers
  couponCode: varchar('coupon_code', { length: 50 }),
  discountAmount: integer('discount_amount').default(0),
  offerDiscount: integer('offer_discount').default(0),
  offerCodes: jsonb('offer_codes'),
});

export const orderItemsTable = pgTable('order_items', {
  id: text('id').primaryKey().$defaultFn(() => generateNumericId()),
  orderId: text('order_id').notNull().references(() => ordersTable.id, { onDelete: "cascade" }),
  productName: varchar('product_name', { length: 255 }).notNull(),
  img: varchar('img', { length: 500 }).notNull(),
  variantId: uuid('variant_id').notNull().references(() => productVariantsTable.id),
  productId: uuid('product_id').notNull().references(() => productsTable.id),
  quantity: integer('quantity').notNull().default(1),
  price: integer('price').notNull(),
  totalPrice: integer('total_price').notNull(),
  size: integer('size').notNull().default(0),
});

// --- COUPONS, REVIEWS, TESTIMONIALS & NOTIFICATIONS ---

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
});


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

export const testimonials = pgTable("testimonials", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  title: text("title"),
  text: text("text").notNull(),
  rating: integer("rating").notNull(),
  avatar: text("avatar"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const notificationsTable = pgTable('notifications', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  message: text('message').notNull(),
  link: text('link'),
  isRead: boolean('is_read').default(false).notNull(),
  type: varchar('type', { length: 50 }).default('general'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  userIdIdx: index('idx_notifications_user_id').on(table.userId),
}));

//  --- PINCODE SERVICEABILITY, TICKETS & BANNERS ---

export const pincodeServiceabilityTable = pgTable('pincode_serviceability', {
  pincode: varchar('pincode', { length: 6 }).primaryKey(),
  city: varchar('city', { length: 100 }).notNull(),
  state: varchar('state', { length: 100 }).notNull(),
  isServiceable: boolean('is_serviceable').default(false),
  codAvailable: boolean('cod_available').default(false),
  onlinePaymentAvailable: boolean('online_payment_available').default(true),
  deliveryCharge: integer('delivery_charge').default(50),
});

export const ticketsTable = pgTable("tickets", {
  id: text("id").primaryKey().$defaultFn(() => generateTicketId()),
  userId: uuid("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  guestEmail: text("guest_email"),
  guestPhone: text("guest_phone"),
  subject: text("subject").notNull().default("Support Query"),
  status: varchar("status", { length: 20 }).default("open").notNull(),
  priority: varchar("priority", { length: 20 }).default("medium"),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const bannersTable = pgTable('banners', {
  id: uuid('id').defaultRandom().primaryKey(),
  title: text('title').notNull(),
  subtitle: text('subtitle'),
  imageUrl: text('image_url').notNull(),
  imageLayer1: text('image_layer_1'),
  imageLayer2: text('image_layer_2'),
  poeticLine: text('poetic_line'),
  description: text('description'),
  link: text('link').default('/products'),
  buttonText: text('button_text').default('Shop Now'),
  type: text('type').default('hero'),
  layout: text('layout').default('split'),
  isActive: boolean('is_active').default(true),
  order: integer('order').default(0),
  createdAt: timestamp('created_at').defaultNow(),
});

export const aboutUsTable = pgTable('about_us', {
  id: uuid('id').defaultRandom().primaryKey(),
  heroTitle: text('hero_title').default('DEVID AURA'),
  heroSubtitle: text('hero_subtitle').default('Est. 2023'),
  heroImage: text('hero_image').notNull(),
  pillar1Title: text('pillar_1_title').default('Unrefined Nature.'),
  pillar1Desc: text('pillar_1_desc'),
  pillar1Image: text('pillar_1_image'),
  pillar2Title: text('pillar_2_title').default('Liquid Patience.'),
  pillar2Desc: text('pillar_2_desc'),
  pillar2Image: text('pillar_2_image'),
  pillar3Title: text('pillar_3_title').default('The Human Canvas.'),
  pillar3Desc: text('pillar_3_desc'),
  pillar3Image: text('pillar_3_image'),
  foundersTitle: text('founders_title').default('Architects of Memory.'),
  foundersQuote: text('founders_quote'),
  foundersDesc: text('founders_desc'),
  foundersImage: text('founders_image'),
  founder1Name: text('founder_1_name').default('Harsh'),
  founder1Role: text('founder_1_role').default('The Nose'),
  founder2Name: text('founder_2_name').default('Yomesh'),
  founder2Role: text('founder_2_role').default('The Eye'),
  footerTitle: text('footer_title').default('Define Your Presence.'),
  footerImageDesktop: text('footer_image_desktop'),
  footerImageMobile: text('footer_image_mobile'),
});

// --- ACTIVITY LOGS  ---
export const activityLogsTable = pgTable('activity_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => usersTable.id, { onDelete: 'cascade' }),
  targetId: uuid('target_id').references(() => usersTable.id, { onDelete: 'set null' }),
  action: varchar('action', { length: 50 }).notNull(),
  description: text('description'),
  metadata: jsonb('metadata'),
  performedBy: varchar('performed_by', { length: 20 }).default('user'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});


// =========================================
// 2. DEFINE ALL RELATIONS LAST
// =========================================


// 1. Users Relations
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
    userClaims: many(rewardClaimsTable)
  }),
}));

// 2. User Address Relations
export const userAddressRelations = relations(UserAddressTable, ({ one }) => ({
  user: one(usersTable, {
    fields: [UserAddressTable.userId],
    references: [usersTable.id],
  }),
}));

// 3. Wallet Transactions Relations
export const walletTransactionsRelations = relations(walletTransactionsTable, ({ one }) => ({
  user: one(usersTable, {
    fields: [walletTransactionsTable.userId],
    references: [usersTable.id],
  }),
}));

// 4. Referrals Relations
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

// 5. Reward Claims Relations
export const rewardClaimsRelations = relations(rewardClaimsTable, ({ one }) => ({
  user: one(usersTable, {
    fields: [rewardClaimsTable.userId],
    references: [usersTable.id],
  }),
}));

// --- PRODUCTS & VARIANTS RELATIONS ---
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
  bundleEntries: many(productBundlesTable, {
    relationName: 'bundleEntries',
  }),
  bundleContents: many(productBundlesTable, {
    relationName: 'bundleContents',
  }),
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

// --- CART, WISHLIST & SAVED FOR LATER RELATIONS ---
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

// --- ORDERS & ORDER ITEMS RELATIONS ---
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

// --- COUPONS, REVIEWS, TESTIMONIALS & NOTIFICATIONS RELATIONS ---
export const couponsRelations = relations(couponsTable, ({ one }) => ({
  targetUser: one(usersTable, {
    fields: [couponsTable.targetUserId],
    references: [usersTable.id],
  }),
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


export const notificationsRelations = relations(notificationsTable, ({ one }) => ({
  user: one(usersTable, {
    fields: [notificationsTable.userId],
    references: [usersTable.id],
  }),
}));

//  ---  TICKETS RELATIONS ---
export const ticketMessagesTable = pgTable("ticket_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  ticketId: text("ticket_id").notNull().references(() => ticketsTable.id, { onDelete: "cascade" }),
  senderRole: varchar("sender_role", { length: 20 }).notNull(),
  message: text("message").notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

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

// --- ACTIVITY LOGS  RELATIONS ---

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

