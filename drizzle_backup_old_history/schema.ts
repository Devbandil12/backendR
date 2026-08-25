import { pgTable, uuid, integer, timestamp, foreignKey, text, varchar, unique, index, serial, boolean, jsonb, json, check, real, primaryKey } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const rewardConfig = pgTable("reward_config", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	refereeBonus: integer("referee_bonus").default(50),
	referrerBonus: integer("referrer_bonus").default(50),
	paparazzi: integer().default(20),
	loyalFollower: integer("loyal_follower").default(20),
	reviewer: integer().default(10),
	monthlyLottery: integer("monthly_lottery").default(100),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
});

export const orderItems = pgTable("order_items", {
	id: text().primaryKey().notNull(),
	orderId: text("order_id").notNull(),
	productName: varchar("product_name", { length: 255 }).notNull(),
	img: varchar({ length: 500 }).notNull(),
	variantId: uuid("variant_id").notNull(),
	productId: uuid("product_id").notNull(),
	quantity: integer().default(1).notNull(),
	price: integer().notNull(),
	totalPrice: integer("total_price").notNull(),
	size: integer().default(0).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.orderId],
			foreignColumns: [orders.id],
			name: "order_items_order_id_orders_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.variantId],
			foreignColumns: [productVariants.id],
			name: "order_items_variant_id_product_variants_id_fk"
		}),
	foreignKey({
			columns: [table.productId],
			foreignColumns: [products.id],
			name: "order_items_product_id_products_id_fk"
		}),
]);

export const orderTimeline = pgTable("order_timeline", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orderId: text("order_id").notNull(),
	status: varchar({ length: 50 }).notNull(),
	title: text().notNull(),
	description: text(),
	timestamp: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.orderId],
			foreignColumns: [orders.id],
			name: "order_timeline_order_id_orders_id_fk"
		}).onDelete("cascade"),
]);

export const shippingRules = pgTable("shipping_rules", {
	id: integer().default(1).primaryKey().notNull(),
	freeShippingThreshold: integer("free_shipping_threshold").default(999),
	flatShippingRate: integer("flat_shipping_rate").default(50),
});

export const supportTags = pgTable("support_tags", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: varchar({ length: 50 }).notNull(),
	color: varchar({ length: 20 }).default('#6B7280'),
	description: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	unique("support_tags_name_unique").on(table.name),
]);

export const ticketMessages = pgTable("ticket_messages", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	ticketId: uuid("ticket_id").notNull(),
	senderRole: varchar("sender_role", { length: 20 }).notNull(),
	senderId: uuid("sender_id"),
	messageType: varchar("message_type", { length: 20 }).default('customer').notNull(),
	message: text().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("ticket_messages_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("ticket_messages_message_type_idx").using("btree", table.messageType.asc().nullsLast().op("text_ops")),
	index("ticket_messages_ticket_id_idx").using("btree", table.ticketId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.ticketId],
			foreignColumns: [tickets.id],
			name: "ticket_messages_ticket_id_tickets_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.senderId],
			foreignColumns: [users.id],
			name: "ticket_messages_sender_id_users_id_fk"
		}).onDelete("set null"),
]);

export const ticketCounter = pgTable("ticket_counter", {
	id: serial().primaryKey().notNull(),
	year: integer().notNull(),
	lastNumber: integer("last_number").default(0).notNull(),
});

export const supportTeams = pgTable("support_teams", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: varchar({ length: 100 }).notNull(),
	description: text(),
	color: varchar({ length: 20 }).default('#6B7280'),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	unique("support_teams_name_unique").on(table.name),
]);

export const ticketEvents = pgTable("ticket_events", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	ticketId: uuid("ticket_id").notNull(),
	actorId: uuid("actor_id"),
	actorRole: varchar("actor_role", { length: 20 }),
	eventType: varchar("event_type", { length: 40 }).notNull(),
	fromValue: text("from_value"),
	toValue: text("to_value"),
	metadata: jsonb(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("ticket_events_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("ticket_events_event_type_idx").using("btree", table.eventType.asc().nullsLast().op("text_ops")),
	index("ticket_events_ticket_id_idx").using("btree", table.ticketId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.ticketId],
			foreignColumns: [tickets.id],
			name: "ticket_events_ticket_id_tickets_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.actorId],
			foreignColumns: [users.id],
			name: "ticket_events_actor_id_users_id_fk"
		}).onDelete("set null"),
]);

export const ticketAttachments = pgTable("ticket_attachments", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	ticketId: uuid("ticket_id").notNull(),
	messageId: uuid("message_id"),
	uploadedByUserId: uuid("uploaded_by_user_id"),
	uploadedByRole: varchar("uploaded_by_role", { length: 20 }).notNull(),
	originalName: text("original_name").notNull(),
	mimeType: varchar("mime_type", { length: 100 }).notNull(),
	size: integer().notNull(),
	storageKey: text("storage_key").notNull(),
	url: text().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("ticket_attachments_message_id_idx").using("btree", table.messageId.asc().nullsLast().op("uuid_ops")),
	index("ticket_attachments_ticket_id_idx").using("btree", table.ticketId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.ticketId],
			foreignColumns: [tickets.id],
			name: "ticket_attachments_ticket_id_tickets_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.messageId],
			foreignColumns: [ticketMessages.id],
			name: "ticket_attachments_message_id_ticket_messages_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.uploadedByUserId],
			foreignColumns: [users.id],
			name: "ticket_attachments_uploaded_by_user_id_users_id_fk"
		}).onDelete("set null"),
]);

export const couponRedemptions = pgTable("coupon_redemptions", {
	id: serial().primaryKey().notNull(),
	couponId: integer("coupon_id").notNull(),
	userId: uuid("user_id").notNull(),
	orderId: text("order_id").notNull(),
	status: varchar().default('pending').notNull(),
	redeemedAt: timestamp("redeemed_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_coupon_redemptions_coupon_status").using("btree", table.couponId.asc().nullsLast().op("int4_ops"), table.status.asc().nullsLast().op("int4_ops")),
	index("idx_coupon_redemptions_coupon_user_status").using("btree", table.couponId.asc().nullsLast().op("int4_ops"), table.userId.asc().nullsLast().op("int4_ops"), table.status.asc().nullsLast().op("int4_ops")),
	index("idx_coupon_redemptions_order_id").using("btree", table.orderId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.couponId],
			foreignColumns: [coupons.id],
			name: "coupon_redemptions_coupon_id_coupons_id_fk"
		}),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "coupon_redemptions_user_id_users_id_fk"
		}),
]);

export const users = pgTable("users", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	clerkId: text("clerk_id").notNull(),
	name: text().notNull(),
	phone: text(),
	email: text().notNull(),
	profileImage: text("profile_image"),
	dob: timestamp({ withTimezone: true, mode: 'string' }),
	gender: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	notifyOrderUpdates: boolean("notify_order_updates").default(true).notNull(),
	notifyPromos: boolean("notify_promos").default(true).notNull(),
	notifyPincode: boolean("notify_pincode").default(true).notNull(),
	pushSubscription: jsonb("push_subscription"),
	referralCode: text("referral_code"),
	referredBy: uuid("referred_by"),
	walletBalance: integer("wallet_balance").default(0).notNull(),
	phoneVerified: boolean("phone_verified").default(false).notNull(),
	phoneVerifiedAt: timestamp("phone_verified_at", { withTimezone: true, mode: 'string' }),
	codDisabled: boolean("cod_disabled").default(false).notNull(),
	codDisabledAt: timestamp("cod_disabled_at", { withTimezone: true, mode: 'string' }),
	codDisabledReason: text("cod_disabled_reason"),
}, (table) => [
	index("users_clerk_id_idx").using("btree", table.clerkId.asc().nullsLast().op("text_ops")),
	index("users_email_idx").using("btree", table.email.asc().nullsLast().op("text_ops")),
	unique("users_clerk_id_unique").on(table.clerkId),
	unique("users_email_unique").on(table.email),
	unique("users_referral_code_unique").on(table.referralCode),
]);

export const permissions = pgTable("permissions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	key: text().notNull(),
	name: text().notNull(),
	group: text().notNull(),
	description: text(),
	isSystem: boolean("is_system").default(true).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("permissions_key_unique").on(table.key),
]);

export const products = pgTable("products", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: varchar({ length: 255 }).notNull(),
	composition: varchar({ length: 255 }).notNull(),
	description: varchar({ length: 255 }).notNull(),
	fragrance: varchar({ length: 255 }).notNull(),
	fragranceNotes: varchar({ length: 255 }).notNull(),
	imageurl: jsonb().default({}).notNull(),
	category: varchar({ length: 100 }).default('Uncategorized'),
	isArchived: boolean("is_archived").default(false).notNull(),
}, (table) => [
	index("product_archived_idx").using("btree", table.isArchived.asc().nullsLast().op("bool_ops")),
	index("product_category_idx").using("btree", table.category.asc().nullsLast().op("text_ops")),
]);

export const banners = pgTable("banners", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	title: text().notNull(),
	subtitle: text(),
	imageUrl: text("image_url").notNull(),
	link: text().default('/products'),
	buttonText: text("button_text").default('Shop Now'),
	isActive: boolean("is_active").default(true),
	order: integer().default(0),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	type: text().default('hero'),
	layout: text().default('split'),
	imageLayer1: text("image_layer_1"),
	imageLayer2: text("image_layer_2"),
	poeticLine: text("poetic_line"),
	description: text(),
	templateType: text("template_type").default('standard'),
	config: json().default({}),
});

export const roles = pgTable("roles", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: text().notNull(),
	description: text(),
	roleType: text("role_type").default('CUSTOM').notNull(),
	isSystem: boolean("is_system").default(false).notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	version: integer().default(1).notNull(),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "roles_created_by_users_id_fk"
		}).onDelete("set null"),
	unique("roles_name_unique").on(table.name),
]);

export const aboutUs = pgTable("about_us", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	heroTitle: text("hero_title").default('DEVID AURA'),
	heroSubtitle: text("hero_subtitle").default('Est. 2023'),
	heroImage: text("hero_image").notNull(),
	pillar1Title: text("pillar_1_title").default('Unrefined Nature.'),
	pillar1Desc: text("pillar_1_desc"),
	pillar1Image: text("pillar_1_image"),
	pillar2Title: text("pillar_2_title").default('Liquid Patience.'),
	pillar2Desc: text("pillar_2_desc"),
	pillar2Image: text("pillar_2_image"),
	pillar3Title: text("pillar_3_title").default('The Human Canvas.'),
	pillar3Desc: text("pillar_3_desc"),
	pillar3Image: text("pillar_3_image"),
	foundersTitle: text("founders_title").default('Architects of Memory.'),
	foundersQuote: text("founders_quote"),
	foundersDesc: text("founders_desc"),
	foundersImage: text("founders_image"),
	founder1Name: text("founder_1_name").default('Harsh'),
	founder1Role: text("founder_1_role").default('The Nose'),
	founder2Name: text("founder_2_name").default('Yomesh'),
	founder2Role: text("founder_2_role").default('The Eye'),
	footerTitle: text("footer_title").default('Define Your Presence.'),
	footerImageDesktop: text("footer_image_desktop"),
	footerImageMobile: text("footer_image_mobile"),
});

export const notifications = pgTable("notifications", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	message: text().notNull(),
	link: text(),
	isRead: boolean("is_read").default(false).notNull(),
	type: varchar({ length: 50 }).default('general'),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_notifications_user_id").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "notifications_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const verifiedPhones = pgTable("verified_phones", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	phone: text().notNull(),
	verifiedAt: timestamp("verified_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "verified_phones_user_id_users_id_fk"
		}).onDelete("cascade"),
	unique("uq_verified_user_phone").on(table.userId, table.phone),
]);

export const userAddress = pgTable("user_address", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	name: text().notNull(),
	phone: text().notNull(),
	altPhone: text("alt_phone"),
	address: text().notNull(),
	city: text().notNull(),
	state: text().notNull(),
	postalCode: text("postal_code").notNull(),
	country: text().default('India').notNull(),
	landmark: text(),
	deliveryInstructions: text("delivery_instructions"),
	addressType: text("address_type"),
	label: text(),
	latitude: text(),
	longitude: text(),
	geoAccuracy: text("geo_accuracy"),
	isDefault: boolean("is_default").default(false),
	isVerified: boolean("is_verified").default(false),
	isDeleted: boolean("is_deleted").default(false),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("user_address_user_id_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "user_address_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const otpVerifications = pgTable("otp_verifications", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	phone: text().notNull(),
	otpHash: text("otp_hash").notNull(),
	purpose: varchar({ length: 30 }).default('cod_checkout').notNull(),
	channel: varchar({ length: 10 }).default('whatsapp').notNull(),
	attempts: integer().default(0).notNull(),
	maxAttempts: integer("max_attempts").default(5).notNull(),
	resendCount: integer("resend_count").default(0).notNull(),
	verified: boolean().default(false).notNull(),
	verifiedAt: timestamp("verified_at", { withTimezone: true, mode: 'string' }),
	verificationToken: text("verification_token"),
	tokenConsumed: boolean("token_consumed").default(false).notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_otp_user_phone").using("btree", table.userId.asc().nullsLast().op("text_ops"), table.phone.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "otp_verifications_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const productBundles = pgTable("product_bundles", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	bundleVariantId: uuid("bundle_variant_id").notNull(),
	contentVariantId: uuid("content_variant_id").notNull(),
	quantity: integer().default(1).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.bundleVariantId],
			foreignColumns: [productVariants.id],
			name: "product_bundles_bundle_variant_id_product_variants_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.contentVariantId],
			foreignColumns: [productVariants.id],
			name: "product_bundles_content_variant_id_product_variants_id_fk"
		}).onDelete("cascade"),
]);

export const codOtpDecisionLog = pgTable("cod_otp_decision_log", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id"),
	phone: text(),
	postalCode: text("postal_code"),
	cartTotal: integer("cart_total"),
	mode: varchar({ length: 10 }).notNull(),
	required: boolean().notNull(),
	reasons: jsonb(),
	orderId: text("order_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "cod_otp_decision_log_user_id_users_id_fk"
		}).onDelete("set null"),
]);

export const pincodeServiceability = pgTable("pincode_serviceability", {
	pincode: varchar({ length: 6 }).primaryKey().notNull(),
	city: varchar({ length: 100 }).notNull(),
	state: varchar({ length: 100 }).notNull(),
	isServiceable: boolean("is_serviceable").default(false),
	codAvailable: boolean("cod_available").default(false),
	onlinePaymentAvailable: boolean("online_payment_available").default(true),
	deliveryCharge: integer("delivery_charge").default(50),
});

export const productVariants = pgTable("product_variants", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	productId: uuid("product_id").notNull(),
	name: text().notNull(),
	size: integer().notNull(),
	oprice: integer().notNull(),
	discount: integer().default(0).notNull(),
	costPrice: integer("cost_price").default(0),
	stock: integer().default(0).notNull(),
	sold: integer().default(0),
	sku: varchar({ length: 100 }),
	isArchived: boolean("is_archived").default(false).notNull(),
	weight: real().default(0.5).notNull(),
	length: real().default(10),
	breadth: real().default(10),
	height: real().default(10),
	isActive: boolean("is_active").default(true),
}, (table) => [
	foreignKey({
			columns: [table.productId],
			foreignColumns: [products.id],
			name: "product_variants_product_id_products_id_fk"
		}).onDelete("cascade"),
	unique("product_variants_sku_unique").on(table.sku),
	check("stock_check", sql`stock >= 0`),
]);

export const analyticsEvents = pgTable("analytics_events", {
	id: serial().primaryKey().notNull(),
	eventType: varchar("event_type", { length: 50 }).notNull(),
	userId: uuid("user_id"),
	sessionId: varchar("session_id", { length: 100 }),
	metadata: varchar({ length: 255 }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_analytics_events_created_at").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_analytics_events_type").using("btree", table.eventType.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "analytics_events_user_id_users_id_fk"
		}).onDelete("set null"),
]);

export const testimonials = pgTable("testimonials", {
	id: serial().primaryKey().notNull(),
	name: text().notNull(),
	title: text(),
	text: text().notNull(),
	rating: integer().notNull(),
	avatar: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
});

export const productReviews = pgTable("product_reviews", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	productId: uuid("product_id").notNull(),
	userId: uuid("user_id").notNull(),
	name: text().notNull(),
	rating: integer().notNull(),
	comment: text().notNull(),
	photoUrls: text("photo_urls").array(),
	isVerifiedBuyer: boolean("is_verified_buyer").default(false),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_reviews_created_at").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_reviews_product_id").using("btree", table.productId.asc().nullsLast().op("uuid_ops")),
	index("idx_reviews_rating").using("btree", table.rating.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.productId],
			foreignColumns: [products.id],
			name: "product_reviews_product_id_products_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "product_reviews_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const addToCart = pgTable("add_to_cart", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	variantId: uuid("variant_id").notNull(),
	quantity: integer().default(1).notNull(),
	addedAt: timestamp("added_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "add_to_cart_user_id_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.variantId],
			foreignColumns: [productVariants.id],
			name: "add_to_cart_variant_id_product_variants_id_fk"
		}).onDelete("cascade"),
]);

export const wishlistTable = pgTable("wishlist_table", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	variantId: uuid("variant_id").notNull(),
	addedAt: timestamp("added_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "wishlist_table_user_id_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.variantId],
			foreignColumns: [productVariants.id],
			name: "wishlist_table_variant_id_product_variants_id_fk"
		}).onDelete("cascade"),
]);

export const savedForLater = pgTable("saved_for_later", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	variantId: uuid("variant_id").notNull(),
	quantity: integer().default(1).notNull(),
	addedAt: timestamp("added_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "saved_for_later_user_id_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.variantId],
			foreignColumns: [productVariants.id],
			name: "saved_for_later_variant_id_product_variants_id_fk"
		}).onDelete("cascade"),
]);

export const referrals = pgTable("referrals", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	referrerId: uuid("referrer_id").notNull(),
	refereeId: uuid("referee_id").notNull(),
	status: varchar({ length: 20 }).default('pending'),
	rewardAmount: integer("reward_amount").default(100),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.referrerId],
			foreignColumns: [users.id],
			name: "referrals_referrer_id_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.refereeId],
			foreignColumns: [users.id],
			name: "referrals_referee_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const walletTransactions = pgTable("wallet_transactions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	amount: integer().notNull(),
	type: varchar({ length: 50 }).notNull(),
	description: text().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("wallet_transactions_user_id_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "wallet_transactions_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const coupons = pgTable("coupons", {
	id: serial().primaryKey().notNull(),
	code: varchar({ length: 50 }).notNull(),
	discountType: varchar("discount_type", { length: 20 }).notNull(),
	discountValue: integer("discount_value").default(0).notNull(),
	description: text(),
	minOrderValue: integer("min_order_value").default(0),
	minItemCount: integer("min_item_count").default(0),
	validFrom: timestamp("valid_from", { mode: 'string' }),
	validUntil: timestamp("valid_until", { mode: 'string' }),
	isFirstOrderOnly: boolean("is_first_order_only").default(false),
	maxUsagePerUser: integer("max_usage_per_user").default(1),
	isAutomatic: boolean("is_automatic").default(false).notNull(),
	condRequiredCategory: varchar("cond_required_category", { length: 100 }),
	actionTargetSize: integer("action_target_size"),
	actionTargetMaxPrice: integer("action_target_max_price"),
	actionBuyX: integer("action_buy_x"),
	actionGetY: integer("action_get_y"),
	condRequiredSize: integer("cond_required_size"),
	maxDiscountAmount: integer("max_discount_amount"),
	targetUserId: uuid("target_user_id"),
	targetCategory: varchar("target_category", { length: 50 }),
	totalUsageLimit: integer("total_usage_limit"),
	isActive: boolean("is_active").default(true).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.targetUserId],
			foreignColumns: [users.id],
			name: "coupons_target_user_id_users_id_fk"
		}).onDelete("cascade"),
	unique("coupons_code_unique").on(table.code),
]);

export const outbox = pgTable("outbox", {
	id: text().primaryKey().notNull(),
	eventType: text("event_type").notNull(),
	payload: jsonb().notNull(),
	processed: boolean().default(false).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
});

export const tickets = pgTable("tickets", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	ticketNumber: text("ticket_number").notNull(),
	userId: uuid("user_id"),
	guestEmail: text("guest_email"),
	guestPhone: text("guest_phone"),
	guestName: text("guest_name"),
	subject: text().default('Support Query').notNull(),
	channel: varchar({ length: 20 }).default('web').notNull(),
	status: varchar({ length: 30 }).default('new').notNull(),
	priority: varchar({ length: 20 }).default('normal').notNull(),
	category: varchar({ length: 50 }),
	subcategory: varchar({ length: 50 }),
	tags: jsonb().default([]),
	assignedAgentId: uuid("assigned_agent_id"),
	assignedTeamId: uuid("assigned_team_id"),
	relatedOrderId: text("related_order_id"),
	relatedPaymentId: text("related_payment_id"),
	relatedShipmentId: text("related_shipment_id"),
	firstResponseAt: timestamp("first_response_at", { withTimezone: true, mode: 'string' }),
	resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: 'string' }),
	archivedAt: timestamp("archived_at", { withTimezone: true, mode: 'string' }),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	firstResponseDueAt: timestamp("first_response_due_at", { withTimezone: true, mode: 'string' }),
	resolutionDueAt: timestamp("resolution_due_at", { withTimezone: true, mode: 'string' }),
	isFirstResponseBreached: boolean("is_first_response_breached").default(false).notNull(),
	isResolutionBreached: boolean("is_resolution_breached").default(false).notNull(),
}, (table) => [
	index("tickets_assigned_agent_idx").using("btree", table.assignedAgentId.asc().nullsLast().op("uuid_ops")),
	index("tickets_assigned_team_idx").using("btree", table.assignedTeamId.asc().nullsLast().op("uuid_ops")),
	index("tickets_category_idx").using("btree", table.category.asc().nullsLast().op("text_ops")),
	index("tickets_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("tickets_first_response_due_idx").using("btree", table.firstResponseDueAt.asc().nullsLast().op("timestamptz_ops")),
	index("tickets_guest_email_idx").using("btree", table.guestEmail.asc().nullsLast().op("text_ops")),
	index("tickets_is_first_response_breached_idx").using("btree", table.isFirstResponseBreached.asc().nullsLast().op("bool_ops")),
	index("tickets_is_resolution_breached_idx").using("btree", table.isResolutionBreached.asc().nullsLast().op("bool_ops")),
	index("tickets_priority_idx").using("btree", table.priority.asc().nullsLast().op("text_ops")),
	index("tickets_resolution_due_idx").using("btree", table.resolutionDueAt.asc().nullsLast().op("timestamptz_ops")),
	index("tickets_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops")),
	index("tickets_ticket_number_idx").using("btree", table.ticketNumber.asc().nullsLast().op("text_ops")),
	index("tickets_updated_at_idx").using("btree", table.updatedAt.asc().nullsLast().op("timestamptz_ops")),
	index("tickets_user_id_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "tickets_user_id_users_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.assignedAgentId],
			foreignColumns: [users.id],
			name: "tickets_assigned_agent_id_users_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.assignedTeamId],
			foreignColumns: [supportTeams.id],
			name: "tickets_assigned_team_id_support_teams_id_fk"
		}).onDelete("set null"),
	unique("tickets_ticket_number_unique").on(table.ticketNumber),
]);

export const rewardClaims = pgTable("reward_claims", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	taskType: varchar("task_type", { length: 50 }).notNull(),
	proof: text().notNull(),
	status: varchar({ length: 20 }).default('pending'),
	rewardAmount: integer("reward_amount").notNull(),
	adminNote: text("admin_note"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "reward_claims_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const lotteryLogs = pgTable("lottery_logs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	winnerId: uuid("winner_id").notNull(),
	actorId: uuid("actor_id"),
	rewardAmount: integer("reward_amount").notNull(),
	drawnAt: timestamp("drawn_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.winnerId],
			foreignColumns: [users.id],
			name: "lottery_logs_winner_id_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.actorId],
			foreignColumns: [users.id],
			name: "lottery_logs_actor_id_users_id_fk"
		}).onDelete("set null"),
]);

export const orders = pgTable("orders", {
	id: text().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	userAddressId: uuid("user_address_id").notNull(),
	razorpayOrderId: text("razorpay_order_id"),
	totalAmount: integer("total_amount").notNull(),
	status: text().default('order placed'),
	progressStep: integer().default(0),
	paymentMode: text("payment_mode").notNull(),
	transactionId: text("transaction_id").default('null'),
	paymentStatus: text("payment_status").default('pending'),
	phone: text().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	discountAmount: integer("discount_amount").default(0),
	offerDiscount: integer("offer_discount").default(0),
	offerCodes: jsonb("offer_codes"),
	walletAmountUsed: integer("wallet_amount_used").default(0),
	courierName: text("courier_name"),
	trackingId: text("tracking_id"),
	trackingUrl: text("tracking_url"),
	expectedDeliveryDate: timestamp("expected_delivery_date", { withTimezone: true, mode: 'string' }),
	shiprocketOrderId: text("shiprocket_order_id"),
	shiprocketShipmentId: text("shiprocket_shipment_id"),
	shiprocketAwb: text("shiprocket_awb"),
	invoiceNumber: varchar("invoice_number", { length: 50 }),
	couponId: integer("coupon_id"),
	paymentContactPhone: text("payment_contact_phone"),
	fulfillmentStatus: text("fulfillment_status").default('PROCESSING'),
	returnStatus: text("return_status").default('NONE'),
	version: integer().default(1).notNull(),
}, (table) => [
	index("orders_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("orders_fulfillment_status_idx").using("btree", table.fulfillmentStatus.asc().nullsLast().op("text_ops")),
	index("orders_invoice_number_idx").using("btree", table.invoiceNumber.asc().nullsLast().op("text_ops")),
	index("orders_payment_status_idx").using("btree", table.paymentStatus.asc().nullsLast().op("text_ops")),
	index("orders_shiprocket_awb_idx").using("btree", table.shiprocketAwb.asc().nullsLast().op("text_ops")),
	index("orders_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops")),
	index("orders_tracking_id_idx").using("btree", table.trackingId.asc().nullsLast().op("text_ops")),
	index("orders_user_id_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "orders_user_id_users_id_fk"
		}),
	foreignKey({
			columns: [table.userAddressId],
			foreignColumns: [userAddress.id],
			name: "orders_user_address_id_user_address_id_fk"
		}),
	foreignKey({
			columns: [table.couponId],
			foreignColumns: [coupons.id],
			name: "orders_coupon_id_coupons_id_fk"
		}),
	unique("orders_invoice_number_unique").on(table.invoiceNumber),
]);

export const supportCsat = pgTable("support_csat", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	ticketId: uuid("ticket_id").notNull(),
	userId: uuid("user_id"),
	rating: integer().notNull(),
	comment: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("support_csat_rating_idx").using("btree", table.rating.asc().nullsLast().op("int4_ops")),
	index("support_csat_ticket_id_idx").using("btree", table.ticketId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.ticketId],
			foreignColumns: [tickets.id],
			name: "support_csat_ticket_id_tickets_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "support_csat_user_id_users_id_fk"
		}).onDelete("set null"),
	unique("support_csat_ticket_id_unique").on(table.ticketId),
]);

export const auditLogs = pgTable("audit_logs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	actorUserId: uuid("actor_user_id"),
	actorType: varchar("actor_type", { length: 20 }).notNull(),
	actorRole: varchar("actor_role", { length: 50 }),
	action: varchar({ length: 100 }).notNull(),
	category: varchar({ length: 50 }).notNull(),
	severity: varchar({ length: 20 }).notNull(),
	resourceType: varchar("resource_type", { length: 50 }),
	resourceId: varchar("resource_id", { length: 100 }),
	description: text(),
	before: jsonb(),
	after: jsonb(),
	changes: jsonb(),
	metadata: jsonb(),
	requestId: varchar("request_id", { length: 100 }),
	ipAddress: varchar("ip_address", { length: 45 }),
	userAgent: text("user_agent"),
	status: varchar({ length: 20 }).notNull(),
	failureReason: text("failure_reason"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	resourceDisplayName: text("resource_display_name"),
	resourceDisplaySubtitle: text("resource_display_subtitle"),
}, (table) => [
	index("audit_logs_action_created_idx").using("btree", table.action.asc().nullsLast().op("text_ops"), table.createdAt.desc().nullsLast().op("timestamptz_ops")),
	index("audit_logs_actor_created_idx").using("btree", table.actorUserId.asc().nullsLast().op("uuid_ops"), table.createdAt.desc().nullsLast().op("timestamptz_ops")),
	index("audit_logs_category_created_idx").using("btree", table.category.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsLast().op("text_ops")),
	index("audit_logs_created_at_idx").using("btree", table.createdAt.desc().nullsLast().op("timestamptz_ops")),
	index("audit_logs_request_id_idx").using("btree", table.requestId.asc().nullsLast().op("text_ops")),
	index("audit_logs_resource_idx").using("btree", table.resourceType.asc().nullsLast().op("text_ops"), table.resourceId.asc().nullsLast().op("text_ops")),
	index("audit_logs_status_created_idx").using("btree", table.status.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.actorUserId],
			foreignColumns: [users.id],
			name: "audit_logs_actor_user_id_users_id_fk"
		}).onDelete("set null"),
]);

export const supportCannedResponses = pgTable("support_canned_responses", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	shortcut: varchar({ length: 50 }).notNull(),
	title: varchar({ length: 100 }).notNull(),
	content: text().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	scope: varchar({ length: 20 }).default('GLOBAL').notNull(),
	createdBy: uuid("created_by"),
	isActive: boolean("is_active").default(true).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("support_canned_responses_shortcut_idx").using("btree", table.shortcut.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "support_canned_responses_created_by_users_id_fk"
		}).onDelete("cascade"),
	unique("unique_canned_response_shortcut").on(table.shortcut, table.scope, table.createdBy),
]);

export const globalAnnouncements = pgTable("global_announcements", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	title: text().notNull(),
	message: text().notNull(),
	type: text().default('INFO').notNull(),
	severity: text().default('Low').notNull(),
	startAt: timestamp("start_at", { withTimezone: true, mode: 'string' }),
	endAt: timestamp("end_at", { withTimezone: true, mode: 'string' }),
	audience: text().default('Everyone').notNull(),
	channels: jsonb().default(["Website Banner"]).notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "global_announcements_created_by_users_id_fk"
		}).onDelete("set null"),
]);

export const siteSettings = pgTable("site_settings", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	mode: text().default('LIVE').notNull(),
	scheduledStart: timestamp("scheduled_start", { withTimezone: true, mode: 'string' }),
	scheduledEnd: timestamp("scheduled_end", { withTimezone: true, mode: 'string' }),
	title: text(),
	message: text(),
	showCountdown: boolean("show_countdown").default(false).notNull(),
	bypassEnabled: boolean("bypass_enabled").default(true).notNull(),
	updatedBy: uuid("updated_by"),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.updatedBy],
			foreignColumns: [users.id],
			name: "site_settings_updated_by_users_id_fk"
		}).onDelete("set null"),
]);

export const siteStatusLogs = pgTable("site_status_logs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	oldMode: text("old_mode").notNull(),
	newMode: text("new_mode").notNull(),
	reason: text(),
	updatedBy: uuid("updated_by"),
	requestId: text("request_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.updatedBy],
			foreignColumns: [users.id],
			name: "site_status_logs_updated_by_users_id_fk"
		}).onDelete("set null"),
]);

export const knowledgeArticles = pgTable("knowledge_articles", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	title: varchar({ length: 255 }).notNull(),
	slug: varchar({ length: 255 }).notNull(),
	category: varchar({ length: 50 }).notNull(),
	content: text().notNull(),
	status: varchar({ length: 20 }).default('DRAFT').notNull(),
	priority: integer().default(0).notNull(),
	version: integer().default(1).notNull(),
	updatedBy: uuid("updated_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("knowledge_articles_category_idx").using("btree", table.category.asc().nullsLast().op("text_ops")),
	index("knowledge_articles_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.updatedBy],
			foreignColumns: [users.id],
			name: "knowledge_articles_updated_by_users_id_fk"
		}).onDelete("set null"),
	unique("knowledge_articles_slug_unique").on(table.slug),
]);

export const returns = pgTable("returns", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orderId: text("order_id").notNull(),
	userId: uuid("user_id").notNull(),
	returnStatus: text("return_status").default('REQUESTED'),
	reason: text().notNull(),
	adminNotes: text("admin_notes"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("returns_order_id_idx").using("btree", table.orderId.asc().nullsLast().op("text_ops")),
	index("returns_status_idx").using("btree", table.returnStatus.asc().nullsLast().op("text_ops")),
	index("returns_user_id_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.orderId],
			foreignColumns: [orders.id],
			name: "returns_order_id_orders_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "returns_user_id_users_id_fk"
		}),
]);

export const returnItems = pgTable("return_items", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	returnId: uuid("return_id").notNull(),
	orderItemId: text("order_item_id").notNull(),
	quantity: integer().default(1).notNull(),
	condition: text(),
}, (table) => [
	foreignKey({
			columns: [table.returnId],
			foreignColumns: [returns.id],
			name: "return_items_return_id_returns_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orderItemId],
			foreignColumns: [orderItems.id],
			name: "return_items_order_item_id_order_items_id_fk"
		}),
]);

export const orderNotes = pgTable("order_notes", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orderId: text("order_id").notNull(),
	adminId: uuid("admin_id").notNull(),
	note: text().notNull(),
	isInternal: boolean("is_internal").default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("order_notes_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("order_notes_order_id_idx").using("btree", table.orderId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.orderId],
			foreignColumns: [orders.id],
			name: "order_notes_order_id_orders_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.adminId],
			foreignColumns: [users.id],
			name: "order_notes_admin_id_users_id_fk"
		}),
]);

export const refunds = pgTable("refunds", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orderId: text("order_id").notNull(),
	returnId: uuid("return_id"),
	amount: integer().notNull(),
	refundStatus: text("refund_status").default('PENDING'),
	gatewayRefundId: text("gateway_refund_id"),
	reason: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	refundSpeed: text("refund_speed"),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("refunds_gateway_refund_id_idx").using("btree", table.gatewayRefundId.asc().nullsLast().op("text_ops")),
	index("refunds_order_id_idx").using("btree", table.orderId.asc().nullsLast().op("text_ops")),
	index("refunds_status_idx").using("btree", table.refundStatus.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.orderId],
			foreignColumns: [orders.id],
			name: "refunds_order_id_orders_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.returnId],
			foreignColumns: [returns.id],
			name: "refunds_return_id_returns_id_fk"
		}).onDelete("set null"),
]);

export const rolePermissions = pgTable("role_permissions", {
	roleId: uuid("role_id").notNull(),
	permissionId: uuid("permission_id").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.roleId],
			foreignColumns: [roles.id],
			name: "role_permissions_role_id_roles_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.permissionId],
			foreignColumns: [permissions.id],
			name: "role_permissions_permission_id_permissions_id_fk"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.roleId, table.permissionId], name: "role_permissions_role_id_permission_id_pk"}),
]);

export const userRoles = pgTable("user_roles", {
	userId: uuid("user_id").notNull(),
	roleId: uuid("role_id").notNull(),
	assignedBy: uuid("assigned_by"),
	assignedAt: timestamp("assigned_at", { mode: 'string' }).defaultNow().notNull(),
	expiresAt: timestamp("expires_at", { mode: 'string' }),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "user_roles_user_id_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.roleId],
			foreignColumns: [roles.id],
			name: "user_roles_role_id_roles_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.assignedBy],
			foreignColumns: [users.id],
			name: "user_roles_assigned_by_users_id_fk"
		}).onDelete("set null"),
	primaryKey({ columns: [table.userId, table.roleId], name: "user_roles_user_id_role_id_pk"}),
]);
