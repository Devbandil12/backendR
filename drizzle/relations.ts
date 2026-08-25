import { relations } from "drizzle-orm/relations";
import { users, userAddress, addToCart, productVariants, wishlistTable, orders, coupons, orderItems, products, productReviews, activityLogs, referrals, walletTransactions, tickets, ticketMessages, productBundles, notifications, savedForLater, rewardClaims, orderTimeline, couponRedemptions, codOtpDecisionLog, otpVerifications, verifiedPhones } from "./schema";

export const userAddressRelations = relations(userAddress, ({one, many}) => ({
	user: one(users, {
		fields: [userAddress.userId],
		references: [users.id]
	}),
	orders: many(orders),
}));

export const usersRelations = relations(users, ({many}) => ({
	userAddresses: many(userAddress),
	addToCarts: many(addToCart),
	wishlistTables: many(wishlistTable),
	orders: many(orders),
	coupons: many(coupons),
	productReviews: many(productReviews),
	activityLogs_userId: many(activityLogs, {
		relationName: "activityLogs_userId_users_id"
	}),
	activityLogs_targetId: many(activityLogs, {
		relationName: "activityLogs_targetId_users_id"
	}),
	referrals_referrerId: many(referrals, {
		relationName: "referrals_referrerId_users_id"
	}),
	referrals_refereeId: many(referrals, {
		relationName: "referrals_refereeId_users_id"
	}),
	walletTransactions: many(walletTransactions),
	notifications: many(notifications),
	savedForLaters: many(savedForLater),
	tickets: many(tickets),
	rewardClaims: many(rewardClaims),
	couponRedemptions: many(couponRedemptions),
	codOtpDecisionLogs: many(codOtpDecisionLog),
	otpVerifications: many(otpVerifications),
	verifiedPhones: many(verifiedPhones),
}));

export const addToCartRelations = relations(addToCart, ({one}) => ({
	user: one(users, {
		fields: [addToCart.userId],
		references: [users.id]
	}),
	productVariant: one(productVariants, {
		fields: [addToCart.variantId],
		references: [productVariants.id]
	}),
}));

export const productVariantsRelations = relations(productVariants, ({one, many}) => ({
	addToCarts: many(addToCart),
	wishlistTables: many(wishlistTable),
	orderItems: many(orderItems),
	productBundles_bundleVariantId: many(productBundles, {
		relationName: "productBundles_bundleVariantId_productVariants_id"
	}),
	productBundles_contentVariantId: many(productBundles, {
		relationName: "productBundles_contentVariantId_productVariants_id"
	}),
	savedForLaters: many(savedForLater),
	product: one(products, {
		fields: [productVariants.productId],
		references: [products.id]
	}),
}));

export const wishlistTableRelations = relations(wishlistTable, ({one}) => ({
	user: one(users, {
		fields: [wishlistTable.userId],
		references: [users.id]
	}),
	productVariant: one(productVariants, {
		fields: [wishlistTable.variantId],
		references: [productVariants.id]
	}),
}));

export const ordersRelations = relations(orders, ({one, many}) => ({
	user: one(users, {
		fields: [orders.userId],
		references: [users.id]
	}),
	userAddress: one(userAddress, {
		fields: [orders.userAddressId],
		references: [userAddress.id]
	}),
	coupon: one(coupons, {
		fields: [orders.couponId],
		references: [coupons.id]
	}),
	orderItems: many(orderItems),
	orderTimelines: many(orderTimeline),
	couponRedemptions: many(couponRedemptions),
}));

export const couponsRelations = relations(coupons, ({one, many}) => ({
	orders: many(orders),
	user: one(users, {
		fields: [coupons.targetUserId],
		references: [users.id]
	}),
	couponRedemptions: many(couponRedemptions),
}));

export const orderItemsRelations = relations(orderItems, ({one}) => ({
	order: one(orders, {
		fields: [orderItems.orderId],
		references: [orders.id]
	}),
	productVariant: one(productVariants, {
		fields: [orderItems.variantId],
		references: [productVariants.id]
	}),
	product: one(products, {
		fields: [orderItems.productId],
		references: [products.id]
	}),
}));

export const productsRelations = relations(products, ({many}) => ({
	orderItems: many(orderItems),
	productReviews: many(productReviews),
	productVariants: many(productVariants),
}));

export const productReviewsRelations = relations(productReviews, ({one}) => ({
	product: one(products, {
		fields: [productReviews.productId],
		references: [products.id]
	}),
	user: one(users, {
		fields: [productReviews.userId],
		references: [users.id]
	}),
}));

export const activityLogsRelations = relations(activityLogs, ({one}) => ({
	user_userId: one(users, {
		fields: [activityLogs.userId],
		references: [users.id],
		relationName: "activityLogs_userId_users_id"
	}),
	user_targetId: one(users, {
		fields: [activityLogs.targetId],
		references: [users.id],
		relationName: "activityLogs_targetId_users_id"
	}),
}));

export const referralsRelations = relations(referrals, ({one}) => ({
	user_referrerId: one(users, {
		fields: [referrals.referrerId],
		references: [users.id],
		relationName: "referrals_referrerId_users_id"
	}),
	user_refereeId: one(users, {
		fields: [referrals.refereeId],
		references: [users.id],
		relationName: "referrals_refereeId_users_id"
	}),
}));

export const walletTransactionsRelations = relations(walletTransactions, ({one}) => ({
	user: one(users, {
		fields: [walletTransactions.userId],
		references: [users.id]
	}),
}));

export const ticketMessagesRelations = relations(ticketMessages, ({one}) => ({
	ticket: one(tickets, {
		fields: [ticketMessages.ticketId],
		references: [tickets.id]
	}),
}));

export const ticketsRelations = relations(tickets, ({one, many}) => ({
	ticketMessages: many(ticketMessages),
	user: one(users, {
		fields: [tickets.userId],
		references: [users.id]
	}),
}));

export const productBundlesRelations = relations(productBundles, ({one}) => ({
	productVariant_bundleVariantId: one(productVariants, {
		fields: [productBundles.bundleVariantId],
		references: [productVariants.id],
		relationName: "productBundles_bundleVariantId_productVariants_id"
	}),
	productVariant_contentVariantId: one(productVariants, {
		fields: [productBundles.contentVariantId],
		references: [productVariants.id],
		relationName: "productBundles_contentVariantId_productVariants_id"
	}),
}));

export const notificationsRelations = relations(notifications, ({one}) => ({
	user: one(users, {
		fields: [notifications.userId],
		references: [users.id]
	}),
}));

export const savedForLaterRelations = relations(savedForLater, ({one}) => ({
	user: one(users, {
		fields: [savedForLater.userId],
		references: [users.id]
	}),
	productVariant: one(productVariants, {
		fields: [savedForLater.variantId],
		references: [productVariants.id]
	}),
}));

export const rewardClaimsRelations = relations(rewardClaims, ({one}) => ({
	user: one(users, {
		fields: [rewardClaims.userId],
		references: [users.id]
	}),
}));

export const orderTimelineRelations = relations(orderTimeline, ({one}) => ({
	order: one(orders, {
		fields: [orderTimeline.orderId],
		references: [orders.id]
	}),
}));

export const couponRedemptionsRelations = relations(couponRedemptions, ({one}) => ({
	coupon: one(coupons, {
		fields: [couponRedemptions.couponId],
		references: [coupons.id]
	}),
	user: one(users, {
		fields: [couponRedemptions.userId],
		references: [users.id]
	}),
	order: one(orders, {
		fields: [couponRedemptions.orderId],
		references: [orders.id]
	}),
}));

export const codOtpDecisionLogRelations = relations(codOtpDecisionLog, ({one}) => ({
	user: one(users, {
		fields: [codOtpDecisionLog.userId],
		references: [users.id]
	}),
}));

export const otpVerificationsRelations = relations(otpVerifications, ({one}) => ({
	user: one(users, {
		fields: [otpVerifications.userId],
		references: [users.id]
	}),
}));

export const verifiedPhonesRelations = relations(verifiedPhones, ({one}) => ({
	user: one(users, {
		fields: [verifiedPhones.userId],
		references: [users.id]
	}),
}));