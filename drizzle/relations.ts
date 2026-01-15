import { relations } from "drizzle-orm/relations";
import { users, notifications, userAddress, productVariants, productBundles, products, productReviews, addToCart, coupons, wishlistTable, savedForLater, tickets, activityLogs, referrals, walletTransactions, orders, orderItems, ticketMessages } from "./schema";

export const notificationsRelations = relations(notifications, ({one}) => ({
	user: one(users, {
		fields: [notifications.userId],
		references: [users.id]
	}),
}));

export const usersRelations = relations(users, ({many}) => ({
	notifications: many(notifications),
	userAddresses: many(userAddress),
	productReviews: many(productReviews),
	addToCarts: many(addToCart),
	coupons: many(coupons),
	wishlistTables: many(wishlistTable),
	savedForLaters: many(savedForLater),
	tickets: many(tickets),
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
	orders: many(orders),
}));

export const userAddressRelations = relations(userAddress, ({one, many}) => ({
	user: one(users, {
		fields: [userAddress.userId],
		references: [users.id]
	}),
	orders: many(orders),
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

export const productVariantsRelations = relations(productVariants, ({one, many}) => ({
	productBundles_bundleVariantId: many(productBundles, {
		relationName: "productBundles_bundleVariantId_productVariants_id"
	}),
	productBundles_contentVariantId: many(productBundles, {
		relationName: "productBundles_contentVariantId_productVariants_id"
	}),
	product: one(products, {
		fields: [productVariants.productId],
		references: [products.id]
	}),
	addToCarts: many(addToCart),
	wishlistTables: many(wishlistTable),
	savedForLaters: many(savedForLater),
	orderItems: many(orderItems),
}));

export const productsRelations = relations(products, ({many}) => ({
	productVariants: many(productVariants),
	productReviews: many(productReviews),
	orderItems: many(orderItems),
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

export const couponsRelations = relations(coupons, ({one}) => ({
	user: one(users, {
		fields: [coupons.targetUserId],
		references: [users.id]
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

export const ticketsRelations = relations(tickets, ({one, many}) => ({
	user: one(users, {
		fields: [tickets.userId],
		references: [users.id]
	}),
	ticketMessages: many(ticketMessages),
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

export const ordersRelations = relations(orders, ({one, many}) => ({
	orderItems: many(orderItems),
	user: one(users, {
		fields: [orders.userId],
		references: [users.id]
	}),
	userAddress: one(userAddress, {
		fields: [orders.userAddressId],
		references: [userAddress.id]
	}),
}));

export const ticketMessagesRelations = relations(ticketMessages, ({one}) => ({
	ticket: one(tickets, {
		fields: [ticketMessages.ticketId],
		references: [tickets.id]
	}),
}));