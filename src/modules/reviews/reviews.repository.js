// src/modules/reviews/reviews.repository.js
// Pure DB queries — no req/res, no business logic.
import { db } from '../../db/client.js';
import { reviewsTable, orderItemsTable, ordersTable, usersTable } from '../../db/schema/index.js';
import { eq, desc, and, sql } from 'drizzle-orm';

export async function findReviewById(id) {
  const [review] = await db.select().from(reviewsTable).where(eq(reviewsTable.id, id));
  return review || null;
}

export async function findReviewsByProduct(productId, { limit = 10, cursor = null, rating = null } = {}) {
  let where = eq(reviewsTable.productId, productId);
  if (rating) where = and(where, eq(reviewsTable.rating, rating));
  if (cursor) where = and(where, sql`${reviewsTable.createdAt} < ${new Date(decodeURIComponent(cursor)).toISOString()}`);
  return db.select({ id: reviewsTable.id, name: reviewsTable.name, userId: reviewsTable.userId, rating: reviewsTable.rating, comment: reviewsTable.comment, photoUrls: reviewsTable.photoUrls, isVerifiedBuyer: reviewsTable.isVerifiedBuyer, createdAt: reviewsTable.createdAt })
    .from(reviewsTable).where(where).orderBy(desc(reviewsTable.createdAt)).limit(limit);
}

export async function findReviewsByUser(userId) {
  return db.select().from(reviewsTable).where(eq(reviewsTable.userId, userId));
}

export async function getReviewStatsForProduct(productId) {
  const [stats] = await db.select({
    averageRating: sql`ROUND(AVG(${reviewsTable.rating})::numeric, 1)`,
    reviewCount: sql`COUNT(*)`,
    one_star: sql`COUNT(*) FILTER (WHERE ${reviewsTable.rating} = 1)`,
    two_star: sql`COUNT(*) FILTER (WHERE ${reviewsTable.rating} = 2)`,
    three_star: sql`COUNT(*) FILTER (WHERE ${reviewsTable.rating} = 3)`,
    four_star: sql`COUNT(*) FILTER (WHERE ${reviewsTable.rating} = 4)`,
    five_star: sql`COUNT(*) FILTER (WHERE ${reviewsTable.rating} = 5)`,
    total_reviews: sql`COUNT(*)`,
  }).from(reviewsTable).where(eq(reviewsTable.productId, productId));
  return stats;
}

export async function insertReview(data) {
  const [review] = await db.insert(reviewsTable).values(data).returning();
  return review;
}

export async function updateReview(id, data) {
  const [updated] = await db.update(reviewsTable).set(data).where(eq(reviewsTable.id, id)).returning();
  return updated;
}

export async function deleteReview(id) {
  const [deleted] = await db.delete(reviewsTable).where(eq(reviewsTable.id, id)).returning();
  return deleted;
}

export async function checkUserPurchased(internalUserId, productId) {
  if (!internalUserId || !productId) return false;
  const purchases = await db.select().from(orderItemsTable)
    .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
    .where(and(eq(ordersTable.userId, internalUserId), eq(orderItemsTable.productId, productId)));
  return purchases.length > 0;
}

export async function resolveUserByClerkId(clerkId) {
  if (!clerkId) return null;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
  return user || null;
}
