import { relations } from "drizzle-orm/relations";
import { orders, orderItems, productVariants, products, orderTimeline, tickets, ticketMessages, users, ticketEvents, ticketAttachments, coupons, couponRedemptions, roles, notifications, verifiedPhones, userAddress, otpVerifications, productBundles, codOtpDecisionLog, analyticsEvents, productReviews, addToCart, wishlistTable, savedForLater, referrals, walletTransactions, supportTeams, rewardClaims, lotteryLogs, supportCsat, auditLogs, supportCannedResponses, globalAnnouncements, siteSettings, siteStatusLogs, knowledgeArticles, returns, returnItems, orderNotes, refunds, rolePermissions, permissions, userRoles } from "./schema";

export const orderItemsRelations = relations(orderItems, ({one, many}) => ({
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
	returnItems: many(returnItems),
}));

export const ordersRelations = relations(orders, ({one, many}) => ({
	orderItems: many(orderItems),
	orderTimelines: many(orderTimeline),
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
	returns: many(returns),
	orderNotes: many(orderNotes),
	refunds: many(refunds),
}));

export const productVariantsRelations = relations(productVariants, ({one, many}) => ({
	orderItems: many(orderItems),
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
}));

export const productsRelations = relations(products, ({many}) => ({
	orderItems: many(orderItems),
	productVariants: many(productVariants),
	productReviews: many(productReviews),
}));

export const orderTimelineRelations = relations(orderTimeline, ({one}) => ({
	order: one(orders, {
		fields: [orderTimeline.orderId],
		references: [orders.id]
	}),
}));

export const ticketMessagesRelations = relations(ticketMessages, ({one, many}) => ({
	ticket: one(tickets, {
		fields: [ticketMessages.ticketId],
		references: [tickets.id]
	}),
	user: one(users, {
		fields: [ticketMessages.senderId],
		references: [users.id]
	}),
	ticketAttachments: many(ticketAttachments),
}));

export const ticketsRelations = relations(tickets, ({one, many}) => ({
	ticketMessages: many(ticketMessages),
	ticketEvents: many(ticketEvents),
	ticketAttachments: many(ticketAttachments),
	user_userId: one(users, {
		fields: [tickets.userId],
		references: [users.id],
		relationName: "tickets_userId_users_id"
	}),
	user_assignedAgentId: one(users, {
		fields: [tickets.assignedAgentId],
		references: [users.id],
		relationName: "tickets_assignedAgentId_users_id"
	}),
	supportTeam: one(supportTeams, {
		fields: [tickets.assignedTeamId],
		references: [supportTeams.id]
	}),
	supportCsats: many(supportCsat),
}));

export const usersRelations = relations(users, ({many}) => ({
	ticketMessages: many(ticketMessages),
	ticketEvents: many(ticketEvents),
	ticketAttachments: many(ticketAttachments),
	couponRedemptions: many(couponRedemptions),
	roles: many(roles),
	notifications: many(notifications),
	verifiedPhones: many(verifiedPhones),
	userAddresses: many(userAddress),
	otpVerifications: many(otpVerifications),
	codOtpDecisionLogs: many(codOtpDecisionLog),
	analyticsEvents: many(analyticsEvents),
	productReviews: many(productReviews),
	addToCarts: many(addToCart),
	wishlistTables: many(wishlistTable),
	savedForLaters: many(savedForLater),
	referrals_referrerId: many(referrals, {
		relationName: "referrals_referrerId_users_id"
	}),
	referrals_refereeId: many(referrals, {
		relationName: "referrals_refereeId_users_id"
	}),
	walletTransactions: many(walletTransactions),
	coupons: many(coupons),
	tickets_userId: many(tickets, {
		relationName: "tickets_userId_users_id"
	}),
	tickets_assignedAgentId: many(tickets, {
		relationName: "tickets_assignedAgentId_users_id"
	}),
	rewardClaims: many(rewardClaims),
	lotteryLogs_winnerId: many(lotteryLogs, {
		relationName: "lotteryLogs_winnerId_users_id"
	}),
	lotteryLogs_actorId: many(lotteryLogs, {
		relationName: "lotteryLogs_actorId_users_id"
	}),
	orders: many(orders),
	supportCsats: many(supportCsat),
	auditLogs: many(auditLogs),
	supportCannedResponses: many(supportCannedResponses),
	globalAnnouncements: many(globalAnnouncements),
	siteSettings: many(siteSettings),
	siteStatusLogs: many(siteStatusLogs),
	knowledgeArticles: many(knowledgeArticles),
	returns: many(returns),
	orderNotes: many(orderNotes),
	userRoles_userId: many(userRoles, {
		relationName: "userRoles_userId_users_id"
	}),
	userRoles_assignedBy: many(userRoles, {
		relationName: "userRoles_assignedBy_users_id"
	}),
}));

export const ticketEventsRelations = relations(ticketEvents, ({one}) => ({
	ticket: one(tickets, {
		fields: [ticketEvents.ticketId],
		references: [tickets.id]
	}),
	user: one(users, {
		fields: [ticketEvents.actorId],
		references: [users.id]
	}),
}));

export const ticketAttachmentsRelations = relations(ticketAttachments, ({one}) => ({
	ticket: one(tickets, {
		fields: [ticketAttachments.ticketId],
		references: [tickets.id]
	}),
	ticketMessage: one(ticketMessages, {
		fields: [ticketAttachments.messageId],
		references: [ticketMessages.id]
	}),
	user: one(users, {
		fields: [ticketAttachments.uploadedByUserId],
		references: [users.id]
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
}));

export const couponsRelations = relations(coupons, ({one, many}) => ({
	couponRedemptions: many(couponRedemptions),
	user: one(users, {
		fields: [coupons.targetUserId],
		references: [users.id]
	}),
	orders: many(orders),
}));

export const rolesRelations = relations(roles, ({one, many}) => ({
	user: one(users, {
		fields: [roles.createdBy],
		references: [users.id]
	}),
	rolePermissions: many(rolePermissions),
	userRoles: many(userRoles),
}));

export const notificationsRelations = relations(notifications, ({one}) => ({
	user: one(users, {
		fields: [notifications.userId],
		references: [users.id]
	}),
}));

export const verifiedPhonesRelations = relations(verifiedPhones, ({one}) => ({
	user: one(users, {
		fields: [verifiedPhones.userId],
		references: [users.id]
	}),
}));

export const userAddressRelations = relations(userAddress, ({one, many}) => ({
	user: one(users, {
		fields: [userAddress.userId],
		references: [users.id]
	}),
	orders: many(orders),
}));

export const otpVerificationsRelations = relations(otpVerifications, ({one}) => ({
	user: one(users, {
		fields: [otpVerifications.userId],
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

export const codOtpDecisionLogRelations = relations(codOtpDecisionLog, ({one}) => ({
	user: one(users, {
		fields: [codOtpDecisionLog.userId],
		references: [users.id]
	}),
}));

export const analyticsEventsRelations = relations(analyticsEvents, ({one}) => ({
	user: one(users, {
		fields: [analyticsEvents.userId],
		references: [users.id]
	}),
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

export const supportTeamsRelations = relations(supportTeams, ({many}) => ({
	tickets: many(tickets),
}));

export const rewardClaimsRelations = relations(rewardClaims, ({one}) => ({
	user: one(users, {
		fields: [rewardClaims.userId],
		references: [users.id]
	}),
}));

export const lotteryLogsRelations = relations(lotteryLogs, ({one}) => ({
	user_winnerId: one(users, {
		fields: [lotteryLogs.winnerId],
		references: [users.id],
		relationName: "lotteryLogs_winnerId_users_id"
	}),
	user_actorId: one(users, {
		fields: [lotteryLogs.actorId],
		references: [users.id],
		relationName: "lotteryLogs_actorId_users_id"
	}),
}));

export const supportCsatRelations = relations(supportCsat, ({one}) => ({
	ticket: one(tickets, {
		fields: [supportCsat.ticketId],
		references: [tickets.id]
	}),
	user: one(users, {
		fields: [supportCsat.userId],
		references: [users.id]
	}),
}));

export const auditLogsRelations = relations(auditLogs, ({one}) => ({
	user: one(users, {
		fields: [auditLogs.actorUserId],
		references: [users.id]
	}),
}));

export const supportCannedResponsesRelations = relations(supportCannedResponses, ({one}) => ({
	user: one(users, {
		fields: [supportCannedResponses.createdBy],
		references: [users.id]
	}),
}));

export const globalAnnouncementsRelations = relations(globalAnnouncements, ({one}) => ({
	user: one(users, {
		fields: [globalAnnouncements.createdBy],
		references: [users.id]
	}),
}));

export const siteSettingsRelations = relations(siteSettings, ({one}) => ({
	user: one(users, {
		fields: [siteSettings.updatedBy],
		references: [users.id]
	}),
}));

export const siteStatusLogsRelations = relations(siteStatusLogs, ({one}) => ({
	user: one(users, {
		fields: [siteStatusLogs.updatedBy],
		references: [users.id]
	}),
}));

export const knowledgeArticlesRelations = relations(knowledgeArticles, ({one}) => ({
	user: one(users, {
		fields: [knowledgeArticles.updatedBy],
		references: [users.id]
	}),
}));

export const returnsRelations = relations(returns, ({one, many}) => ({
	order: one(orders, {
		fields: [returns.orderId],
		references: [orders.id]
	}),
	user: one(users, {
		fields: [returns.userId],
		references: [users.id]
	}),
	returnItems: many(returnItems),
	refunds: many(refunds),
}));

export const returnItemsRelations = relations(returnItems, ({one}) => ({
	return: one(returns, {
		fields: [returnItems.returnId],
		references: [returns.id]
	}),
	orderItem: one(orderItems, {
		fields: [returnItems.orderItemId],
		references: [orderItems.id]
	}),
}));

export const orderNotesRelations = relations(orderNotes, ({one}) => ({
	order: one(orders, {
		fields: [orderNotes.orderId],
		references: [orders.id]
	}),
	user: one(users, {
		fields: [orderNotes.adminId],
		references: [users.id]
	}),
}));

export const refundsRelations = relations(refunds, ({one}) => ({
	order: one(orders, {
		fields: [refunds.orderId],
		references: [orders.id]
	}),
	return: one(returns, {
		fields: [refunds.returnId],
		references: [returns.id]
	}),
}));

export const rolePermissionsRelations = relations(rolePermissions, ({one}) => ({
	role: one(roles, {
		fields: [rolePermissions.roleId],
		references: [roles.id]
	}),
	permission: one(permissions, {
		fields: [rolePermissions.permissionId],
		references: [permissions.id]
	}),
}));

export const permissionsRelations = relations(permissions, ({many}) => ({
	rolePermissions: many(rolePermissions),
}));

export const userRolesRelations = relations(userRoles, ({one}) => ({
	user_userId: one(users, {
		fields: [userRoles.userId],
		references: [users.id],
		relationName: "userRoles_userId_users_id"
	}),
	role: one(roles, {
		fields: [userRoles.roleId],
		references: [roles.id]
	}),
	user_assignedBy: one(users, {
		fields: [userRoles.assignedBy],
		references: [users.id],
		relationName: "userRoles_assignedBy_users_id"
	}),
}));