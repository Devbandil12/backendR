import { db } from "../configs/index.js";
import {
  reviewsTable,
  orderItemsTable,
  ordersTable,
  usersTable,
} from "../configs/schema.js";
import { eq, desc, sql, and } from "drizzle-orm";

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

// ✅ Create Review
export const createReview = async (req, res) => {
  try {
    const {
      name,
      rating,
      comment,
      photoUrls,
      productId,
      userId, // Clerk ID or UUID
      clerkId
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

    res.status(201).json(review);
  } catch (err) {
    console.error("❌ Failed to create review:", err);
    res.status(500).json({ error: "Server error" });
  }
};

// ✅ Get Reviews By Product — with optional star rating filter

export const getReviewsByProduct = async (req, res) => {
  const { productId } = req.params;
  const {
    rating,
    limit = 10,
    cursor, // ISO timestamp string
  } = req.query;

  const parsedLimit = Math.min(parseInt(limit, 10) || 10, 50); // Limit max per request
  const parsedRating = rating ? parseInt(rating, 10) : null;

  try {
    // 🧱 Base WHERE clause
    let baseWhere = eq(reviewsTable.productId, productId);

    if (parsedRating) {
      baseWhere = and(
        baseWhere,
        eq(reviewsTable.rating, parsedRating)
      );
    }

    // 🧭 Cursor condition (createdAt < cursor)
    let fullWhere = baseWhere;
    if (cursor) {
      const cursorDate = new Date(decodeURIComponent(cursor));
      fullWhere = and(
        baseWhere,
        sql`${reviewsTable.createdAt} < ${cursorDate.toISOString()}`
      );
    }

    // 🚀 Fetch reviews with cursor-based pagination
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

    // 📊 Fetch review stats in ONE fast SQL query
    const [stats] = await db.execute(sql`
      SELECT
        COUNT(*) AS total_reviews,
        ROUND(AVG(rating)::numeric, 1) AS average_rating,
        COUNT(*) FILTER (WHERE rating = 5) AS five_star,
        COUNT(*) FILTER (WHERE rating = 4) AS four_star,
        COUNT(*) FILTER (WHERE rating = 3) AS three_star,
        COUNT(*) FILTER (WHERE rating = 2) AS two_star,
        COUNT(*) FILTER (WHERE rating = 1) AS one_star
      FROM product_reviews
      WHERE product_id = ${productId}
    `);

    const totalReviews = parseInt(stats.total_reviews || 0);
    const averageRating = parseFloat(stats.average_rating || 0);

    const ratingCounts = {
      5: parseInt(stats.five_star || 0),
      4: parseInt(stats.four_star || 0),
      3: parseInt(stats.three_star || 0),
      2: parseInt(stats.two_star || 0),
      1: parseInt(stats.one_star || 0),
    };

    // 🧭 Set next cursor (for frontend)
    const lastReview = reviews[reviews.length - 1];
    const nextCursor = lastReview
      ? encodeURIComponent(lastReview.createdAt.toISOString())
      : null;

    // 🧼 Sanitize photo URLs
    const parsedReviews = reviews.map((r) => ({
      ...r,
      photoUrls: Array.isArray(r.photoUrls) ? r.photoUrls : [],
    }));

    // ✅ Return response
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
    res.status(500).json({ error: "Server error" });
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
    const deleted = await db
      .delete(reviewsTable)
      .where(eq(reviewsTable.id, id))
      .returning();

    res.json({ success: true, deleted });
  } catch (err) {
    console.error("❌ Failed to delete review:", err);
    res.status(500).json({ error: "Server error" });
  }
};

// ✅ Update Review — includes rechecking isVerifiedBuyer
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
      .where(eq(reviewsTable
.id, id))
      .returning();

    res.json({ success: true, updated });
  } catch (err) {
    console.error("❌ Failed to update review:", err);
    res.status(500).json({ error: "Server error" });
  }
};