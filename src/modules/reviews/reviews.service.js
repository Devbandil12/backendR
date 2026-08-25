// src/modules/reviews/reviews.service.js
// Business logic layer — calls repository, handles rules.
import {
  findReviewById, findReviewsByProduct, findReviewsByUser,
  getReviewStatsForProduct, insertReview, updateReview as repoUpdateReview,
  deleteReview as repoDeleteReview, checkUserPurchased, resolveUserByClerkId,
} from './reviews.repository.js';
import { invalidateMultiple } from '../../infrastructure/cache/cache.invalidate.js';
import { makeProductReviewsPrefix, makeProductReviewStatsKey, makeUserReviewsKey } from '../../infrastructure/cache/cache.keys.js';

async function invalidateReviewCaches(productId, userId) {
  const items = [
    { key: makeProductReviewsPrefix(productId), prefix: true },
    { key: makeProductReviewStatsKey(productId) },
  ];
  if (userId) items.push({ key: makeUserReviewsKey(userId) });
  await invalidateMultiple(items);
}

export async function createReview(clerkId, { rating, comment, photoUrls, productId }) {
  const user = await resolveUserByClerkId(clerkId);
  if (!user) throw Object.assign(new Error('Unauthorized'), { status: 401 });
  if (!rating || !comment || !productId) throw Object.assign(new Error('Missing required fields'), { status: 400 });

  const isVerifiedBuyer = await checkUserPurchased(user.id, productId);
  const review = await insertReview({
    name: user.name || 'Anonymous',
    userId: user.id,
    rating: parseInt(rating),
    comment,
    photoUrls: Array.isArray(photoUrls) ? photoUrls : [],
    productId,
    isVerifiedBuyer,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await invalidateReviewCaches(productId, user.id);
  return review;
}

export async function getReviewsByProduct(productId, query) {
  const limit = Math.min(parseInt(query.limit, 10) || 10, 50);
  const reviews = await findReviewsByProduct(productId, { limit, cursor: query.cursor, rating: query.rating ? parseInt(query.rating) : null });
  const stats = await getReviewStatsForProduct(productId);
  const lastReview = reviews[reviews.length - 1];
  return {
    reviews: reviews.map(r => ({ ...r, photoUrls: Array.isArray(r.photoUrls) ? r.photoUrls : [] })),
    totalReviews: Number(stats?.total_reviews || 0),
    averageRating: Number(stats?.averageRating || 0),
    ratingCounts: { 1: Number(stats?.one_star || 0), 2: Number(stats?.two_star || 0), 3: Number(stats?.three_star || 0), 4: Number(stats?.four_star || 0), 5: Number(stats?.five_star || 0) },
    nextCursor: lastReview ? encodeURIComponent(lastReview.createdAt.toISOString()) : null,
    hasMore: reviews.length === limit,
  };
}

export async function getReviewStats(productId) {
  const stats = await getReviewStatsForProduct(productId);
  return {
    averageRating: parseFloat(stats?.averageRating || 0),
    reviewCount: parseInt(stats?.reviewCount || 0),
    ratingCounts: { 1: Number(stats?.one_star || 0), 2: Number(stats?.two_star || 0), 3: Number(stats?.three_star || 0), 4: Number(stats?.four_star || 0), 5: Number(stats?.five_star || 0) },
  };
}

export async function deleteReview(clerkId, reviewId) {
  const user = await resolveUserByClerkId(clerkId);
  if (!user) throw Object.assign(new Error('Unauthorized'), { status: 401 });
  const review = await findReviewById(reviewId);
  if (!review) throw Object.assign(new Error('Review not found'), { status: 404 });
  if (review.userId !== user.id && user.role !== 'admin') throw Object.assign(new Error('Forbidden: Not your review'), { status: 403 });
  const deleted = await repoDeleteReview(reviewId);
  await invalidateReviewCaches(review.productId, review.userId);
  return deleted;
}

export async function updateReview(clerkId, reviewId, { rating, comment, photoUrls }) {
  const user = await resolveUserByClerkId(clerkId);
  if (!user) throw Object.assign(new Error('Unauthorized'), { status: 401 });
  const existing = await findReviewById(reviewId);
  if (!existing) throw Object.assign(new Error('Review not found'), { status: 404 });
  if (existing.userId !== user.id && user.role !== 'admin') throw Object.assign(new Error('Forbidden: Not your review'), { status: 403 });
  const isVerifiedBuyer = await checkUserPurchased(existing.userId, existing.productId);
  const updated = await repoUpdateReview(reviewId, { ...(rating && { rating: parseInt(rating) }), ...(comment && { comment }), ...(photoUrls && { photoUrls }), isVerifiedBuyer, updatedAt: new Date() });
  await invalidateReviewCaches(existing.productId, existing.userId);
  return updated;
}

export async function checkIsVerifiedBuyer(userId, clerkId, productId) {
  const { db } = await import('../../db/client.js');
  const { usersTable } = await import('../../db/schema/index.js');
  const { eq } = await import('drizzle-orm');
  let internalUserId = null;
  let [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId || clerkId));
  if (!user && clerkId) [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
  internalUserId = user ? user.id : null;
  return checkUserPurchased(internalUserId, productId);
}

export async function getReviewsByUser(userId) {
  return findReviewsByUser(userId);
}
