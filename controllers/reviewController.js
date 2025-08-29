import { db } from "../configs/index.js";
import {
  reviewsTable,
  orderItemsTable,
  ordersTable,
  usersTable,
} from "../configs/schema.js";
import { eq, desc, sql, and } from "drizzle-orm";

// 🟢 Import cache helpers
import { invalidateCache } from "../cacheMiddleware.js";

// 🔧 Helper: Map Clerk ID or UUID → internal UUID
const resolveUserId = async (userId) => {
  if (!userId) return null;

  let [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) {
    [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, userId));
  }

  return user ? user.id : null;
};

// 🔧 Helper: Check if user has purchased a product
const hasPurchasedProduct = async (internalUserId, productId) => {
  if (!internalUserId || !productId) return false;

  const purchases = await db
    .select()
    .from(orderItemsTable)
    .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
    .where(
      and(
        eq(ordersTable.userId, internalUserId),
        eq(orderItemsTable.productId, productId)
      )
    );

  return purchases.length > 0;
};

// 🔧 Helper: invalidate all review cache variants for a product + user
const invalidateReviewCaches = async (productId, userId) => {
  const keys = [
    `product-reviews:${productId}:all`,
    `product-reviews:${productId}:1`,
    `product-reviews:${productId}:2`,
    `product-reviews:${productId}:3`,
    `product-reviews:${productId}:4`,
    `product-reviews:${productId}:5`,
    `review-stats:${productId}`,
  ];
  if (userId) keys.push(`user-reviews:${userId}`);

  for (const key of keys) {
    await invalidateCache(key);
  }
};

// ✅ Create Review
export const createReview = async (req, res) => {
  try {
    const {
      name,
      rating,
      comment,
      photoUrls,
      productId,
      userId,
      clerkId,
    } = req.body;

    if (!rating || !comment || !productId) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const internalUserId = await resolveUserId(userId || clerkId);
    const isVerified = await hasPurchasedProduct(internalUserId, productId);

    const [review] = await db
      .insert(reviewsTable)
      .values({
        name: name || "Anonymous",
        userId: internalUserId,
        rating: parseInt(rating),
        comment,
        photoUrls: Array.isArray(photoUrls) ? photoUrls : [],
        productId,
        isVerifiedBuyer: isVerified,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    // 🟢 Invalidate cache
    await invalidateReviewCaches(productId, internalUserId);

    res.status(201).json(review);
  } catch (err) {
    console.error("❌ Failed to create review:", err);
    res.status(500).json({ error: "Server error" });
  }
};

// ✅ Get Reviews By Product
export const getReviewsByProduct = async (req, res) => {
  const { productId } = req.params;
  const { rating, limit = 10, cursor } = req.query;

  const parsedLimit = Math.min(parseInt(limit, 10) || 10, 50);
  const parsedRating = rating ? parseInt(rating, 10) : null;

  try {
    let baseWhere = eq(reviewsTable.productId, productId);
    if (parsedRating) {
      baseWhere = and(baseWhere, eq(reviewsTable.rating, parsedRating));
    }

    let fullWhere = baseWhere;
    if (cursor) {
      const cursorDate = new Date(decodeURIComponent(cursor));
      fullWhere = and(
        baseWhere,
        sql`${reviewsTable.createdAt} < ${cursorDate.toISOString()}`
      );
    }

    const reviews = await db
      .select({
        id: reviewsTable.id,
        name: reviewsTable.name,
        userId: reviewsTable.userId,
        rating: reviewsTable.rating,
        comment: reviewsTable.comment,
        photoUrls: reviewsTable.photoUrls,
        isVerifiedBuyer: reviewsTable.isVerifiedBuyer,
        createdAt: reviewsTable.createdAt,
      })
      .from(reviewsTable)
      .where(fullWhere)
      .orderBy(desc(reviewsTable.createdAt))
      .limit(parsedLimit);

    const [stats] = await db
      .select({
        average_rating: sql`ROUND(AVG(${reviewsTable.rating})::numeric, 1)`.as("average_rating"),
        one_star: sql`COUNT(*) FILTER (WHERE ${reviewsTable.rating} = 1)`.as("one_star"),
        two_star: sql`COUNT(*) FILTER (WHERE ${reviewsTable.rating} = 2)`.as("two_star"),
        three_star: sql`COUNT(*) FILTER (WHERE ${reviewsTable.rating} = 3)`.as("three_star"),
        four_star: sql`COUNT(*) FILTER (WHERE ${reviewsTable.rating} = 4)`.as("four_star"),
        five_star: sql`COUNT(*) FILTER (WHERE ${reviewsTable.rating} = 5)`.as("five_star"),
        total_reviews: sql`COUNT(*)`.as("total_reviews"),
      })
      .from(reviewsTable)
      .where(eq(reviewsTable.productId, productId));

    const ratingCounts = {
      1: Number(stats.one_star || 0),
      2: Number(stats.two_star || 0),
      3: Number(stats.three_star || 0),
      4: Number(stats.four_star || 0),
      5: Number(stats.five_star || 0),
    };
    const averageRating = Number(stats.average_rating || 0);
    const totalReviews = Number(stats.total_reviews || 0);
    const lastReview = reviews[reviews.length - 1];
    const nextCursor = lastReview ? encodeURIComponent(lastReview.createdAt.toISOString()) : null;
    const parsedReviews = reviews.map((r) => ({
      ...r,
      photoUrls: Array.isArray(r.photoUrls) ? r.photoUrls : [],
    }));

    return res.json({
      reviews: parsedReviews,
      totalReviews,
      averageRating,
      ratingCounts,
      nextCursor,
      hasMore: reviews.length === parsedLimit,
    });
  } catch (err) {
    console.error("❌ Error in getReviewsByProduct:", err);
    return res.status(500).json({ error: "Server error" });
  }
};

// ✅ Get Review Stats
export const getReviewStats = async (req, res) => {
  const { productId } = req.params;

  try {
    const [stats] = await db
      .select({
        averageRating: sql`ROUND(AVG(${reviewsTable.rating})::numeric, 1)`,
        reviewCount: sql`COUNT(*)`,
      })
      .from(reviewsTable)
      .where(eq(reviewsTable.productId, productId));

    res.json({
      averageRating: parseFloat(stats?.averageRating || 0),
      reviewCount: parseInt(stats?.reviewCount || 0),
    });
  } catch (err) {
    console.error("❌ Failed to fetch review stats:", err);
    res.status(500).json({ error: "Server error" });
  }
};

// ✅ Check Verified Buyer
export const isVerifiedBuyer = async (req, res) => {
  const { userId, clerkId, productId } = req.query;

  try {
    const internalUserId = await resolveUserId(userId || clerkId);
    const isVerified = await hasPurchasedProduct(internalUserId, productId);
    res.json({ verified: isVerified });
  } catch (err) {
    console.error("❌ Failed to verify purchase:", err);
    res.status(500).json({ error: "Server error" });
  }
};

// ✅ Delete Review
export const deleteReview = async (req, res) => {
  const { id } = req.params;

  try {
    const [reviewToDelete] = await db
      .select({ productId: reviewsTable.productId, userId: reviewsTable.userId })
      .from(reviewsTable)
      .where(eq(reviewsTable.id, id));

    const deleted = await db
      .delete(reviewsTable)
      .where(eq(reviewsTable.id, id))
      .returning();

    if (reviewToDelete) {
      await invalidateReviewCaches(reviewToDelete.productId, reviewToDelete.userId);
    }

    res.json({ success: true, deleted });
  } catch (err) {
    console.error("❌ Failed to delete review:", err);
    res.status(500).json({ error: "Server error" });
  }
};

// ✅ Update Review
export const updateReview = async (req, res) => {
  const { id } = req.params;
  const { rating, comment, photoUrls } = req.body;

  try {
    const [existing] = await db
      .select()
      .from(reviewsTable)
      .where(eq(reviewsTable.id, id));

    if (!existing) {
      return res.status(404).json({ error: "Review not found" });
    }

    const isVerified = await hasPurchasedProduct(existing.userId, existing.productId);

    const updated = await db
      .update(reviewsTable)
      .set({
        ...(rating && { rating: parseInt(rating) }),
        ...(comment && { comment }),
        ...(photoUrls && { photoUrls }),
        isVerifiedBuyer: isVerified,
        updatedAt: new Date(),
      })
      .where(eq(reviewsTable.id, id))
      .returning();

    await invalidateReviewCaches(existing.productId, existing.userId);

    res.json({ success: true, updated });
  } catch (err) {
    console.error("❌ Failed to update review:", err);
    res.status(500).json({ error: "Server error" });
  }
};

// ✅ Get Reviews by User
export const getReviewsByUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const reviews = await db.select().from(reviewsTable).where(eq(reviewsTable.userId, userId));
    res.json(reviews);
  } catch (error) {
    console.error("❌ Error fetching user reviews:", error);
    res.status(500).json({ error: "Server error" });
  }
};
