
import { db } from "../configs/index.js";
import {
  reviewsTable,
  orderItemsTable,
  ordersTable,
  usersTable,
} from "../configs/schema.js";
import { eq, desc, sql, and } from "drizzle-orm";

// âœ… Create Review
export const createReview = async (req, res) => {
  try {
    const {
      name,
      rating,
      comment,
      photoUrls,
      productId,
      userId, // This could be Clerk ID or internal UUID
    } = req.body;

    if (!rating || !comment || !productId) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    let internalUserId = null;
    
    // If userId is provided, try to find the user
    if (userId) {
      // First try to find by UUID (internal ID)
      let [user] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.id, userId));

      // If not found, try to find by Clerk ID
      if (!user) {
        [user] = await db
          .select()
          .from(usersTable)
          .where(eq(usersTable.clerkId, userId));
      }

      if (user) {
        internalUserId = user.id;
      }
    }

    // ðŸ” Check if user has purchased the product (only if we have a user)
    let isVerified = false;
    if (internalUserId) {
      const previousPurchases = await db
        .select()
        .from(orderItemsTable)
        .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
        .where(
          and(
            eq(ordersTable.userId, internalUserId),
            eq(orderItemsTable.productId, productId)
          )
        );

      isVerified = previousPurchases.length > 0;
    }

    // ðŸ“ Insert review
    const [review] = await db
      .insert(reviewsTable)
      .values({
        name: name || 'Anonymous',
        userId: internalUserId,
        rating: parseInt(rating),
        comment,
        photoUrls: photoUrls ? JSON.stringify(photoUrls) : null,
        productId,
        isVerifiedBuyer: isVerified,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    res.status(201).json(review);
  } catch (err) {
    console.error("âŒ Failed to create review:", err);
    res.status(500).json({ error: "Server error" });
  }
};

// âœ… Get Reviews By Product
export const getReviewsByProduct = async (req, res) => {
  const { productId } = req.params;

  try {
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
      .where(eq(reviewsTable.productId, productId))
      .orderBy(desc(reviewsTable.createdAt));

    // Parse photoUrls JSON string back to array
    const parsedReviews = reviews.map(review => ({
      ...review,
      photoUrls: review.photoUrls ? JSON.parse(review.photoUrls) : []
    }));

    res.json(parsedReviews);
  } catch (err) {
    console.error("âŒ Failed to fetch reviews:", err);
    res.status(500).json({ error: "Server error" });
  }
};

// âœ… Get Review Stats
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
      averageRating: parseFloat(stats.averageRating || 0),
      reviewCount: parseInt(stats.reviewCount || 0),
    });
  } catch (err) {
    console.error("âŒ Failed to fetch review stats:", err);
    res.status(500).json({ error: "Server error" });
  }
};

// âœ… Check Verified Buyer
export const isVerifiedBuyer = async (req, res) => {
  const { userId, productId } = req.query;

  try {
    if (!userId) {
      return res.json({ verified: false });
    }

    // Try to find user by UUID first, then by Clerk ID
    let [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, userId));

    if (!user) {
      [user] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.clerkId, userId));
    }

    if (!user) {
      return res.json({ verified: false });
    }

    const orders = await db
      .select()
      .from(orderItemsTable)
      .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
      .where(
        and(
          eq(ordersTable.userId, user.id),
          eq(orderItemsTable.productId, productId)
        )
      );

    res.json({ verified: orders.length > 0 });
  } catch (err) {
    console.error("âŒ Failed to verify purchase:", err);
    res.status(500).json({ error: "Server error" });
  }
};

// âœ… Delete Review
export const deleteReview = async (req, res) => {
  const { id } = req.params;

  try {
    const deleted = await db
      .delete(reviewsTable)
      .where(eq(reviewsTable.id, id))
      .returning();

    res.json({ success: true, deleted });
  } catch (err) {
    console.error("âŒ Failed to delete review:", err);
    res.status(500).json({ error: "Server error" });
  }
};

// âœ… Update Review
export const updateReview = async (req, res) => {
  const { id } = req.params;
  const { rating, comment, photoUrls } = req.body;

  try {
    const updated = await db
      .update(reviewsTable)
      .set({
        ...(rating && { rating: parseInt(rating) }),
        ...(comment && { comment }),
        ...(photoUrls && { photoUrls: JSON.stringify(photoUrls) }),
        updatedAt: new Date(),
      })
      .where(eq(reviewsTable.id, id))
      .returning();

    res.json({ success: true, updated });
  } catch (err) {
    console.error("âŒ Failed to update review:", err);
    res.status(500).json({ error: "Server error" });
  }
};