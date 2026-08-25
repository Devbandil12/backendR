import { pgTable, foreignKey, uuid, text, boolean, timestamp, integer, unique, jsonb, varchar, serial, index, real, json } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



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
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "user_address_user_id_users_id_fk"
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

export const users = pgTable("users", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	clerkId: text("clerk_id").notNull(),
	name: text().notNull(),
	phone: text(),
	email: text().notNull(),
	role: text().default('user'),
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
	unique("users_clerk_id_unique").on(table.clerkId),
	unique("users_email_unique").on(table.email),
	unique("users_referral_code_unique").on(table.referralCode),
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
});

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
	refundId: text("refund_id"),
	refundAmount: integer("refund_amount"),
	refundStatus: text("refund_status"),
	refundSpeed: text("refund_speed"),
	refundInitiatedAt: timestamp("refund_initiated_at", { mode: 'string' }),
	refundCompletedAt: timestamp("refund_completed_at", { mode: 'string' }),
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
	couponId: integer("coupon_id"),
	invoiceNumber: varchar("invoice_number", { length: 50 }),
	paymentContactPhone: text("payment_contact_phone"),
}, (table) => [
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

export const orderItems = pgTable("order_items", {
	id: text().primaryKey().notNull(),
	orderId: text("order_id").notNull(),
	productName: varchar("product_name", { length: 255 }).notNull(),
	img: varchar({ length: 500 }).notNull(),
	productId: uuid("product_id").notNull(),
	quantity: integer().default(1).notNull(),
	price: integer().notNull(),
	totalPrice: integer("total_price").notNull(),
	size: integer().default(0).notNull(),
	variantId: uuid("variant_id").notNull(),
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
	maxDiscountAmount: integer("max_discount_amount"),
	isAutomatic: boolean("is_automatic").default(false).notNull(),
	condRequiredCategory: varchar("cond_required_category", { length: 100 }),
	actionTargetSize: integer("action_target_size"),
	actionTargetMaxPrice: integer("action_target_max_price"),
	condRequiredSize: integer("cond_required_size"),
	actionBuyX: integer("action_buy_x"),
	actionGetY: integer("action_get_y"),
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

export const activityLogs = pgTable("activity_logs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id"),
	targetId: uuid("target_id"),
	action: varchar({ length: 50 }).notNull(),
	description: text(),
	metadata: jsonb(),
	performedBy: varchar("performed_by", { length: 20 }).default('user'),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "activity_logs_user_id_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.targetId],
			foreignColumns: [users.id],
			name: "activity_logs_target_id_users_id_fk"
		}).onDelete("set null"),
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
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "wallet_transactions_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const pincodeServiceability = pgTable("pincode_serviceability", {
	pincode: varchar({ length: 6 }).primaryKey().notNull(),
	isServiceable: boolean("is_serviceable").default(false),
	codAvailable: boolean("cod_available").default(false),
	onlinePaymentAvailable: boolean("online_payment_available").default(true),
	deliveryCharge: integer("delivery_charge").default(50),
	city: varchar({ length: 100 }).notNull(),
	state: varchar({ length: 100 }).notNull(),
});

export const ticketMessages = pgTable("ticket_messages", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	ticketId: text("ticket_id").notNull(),
	senderRole: varchar("sender_role", { length: 20 }).notNull(),
	message: text().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.ticketId],
			foreignColumns: [tickets.id],
			name: "ticket_messages_ticket_id_tickets_id_fk"
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

export const tickets = pgTable("tickets", {
	id: text().primaryKey().notNull(),
	userId: uuid("user_id"),
	guestEmail: text("guest_email"),
	guestPhone: text("guest_phone"),
	subject: text().default('Support Query').notNull(),
	status: varchar({ length: 20 }).default('open').notNull(),
	priority: varchar({ length: 20 }).default('medium'),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "tickets_user_id_users_id_fk"
		}).onDelete("set null"),
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
	isArchived: boolean("is_archived").default(false).notNull(),
	sku: varchar({ length: 100 }),
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
]);

export const banners = pgTable("banners", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	title: text().notNull(),
	subtitle: text(),
	imageUrl: text("image_url").notNull(),
	imageLayer1: text("image_layer_1"),
	imageLayer2: text("image_layer_2"),
	poeticLine: text("poetic_line"),
	description: text(),
	link: text().default('/products'),
	buttonText: text("button_text").default('Shop Now'),
	type: text().default('hero'),
	layout: text().default('split'),
	isActive: boolean("is_active").default(true),
	order: integer().default(0),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	templateType: text("template_type").default('standard'),
	config: json().default({}),
});

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
	foreignKey({
			columns: [table.orderId],
			foreignColumns: [orders.id],
			name: "coupon_redemptions_order_id_orders_id_fk"
		}),
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
