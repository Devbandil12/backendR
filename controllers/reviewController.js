import { db } from "../configs/index.js";
import {
  reviewsTable,
  orderItemsTable,
  ordersTable,
  usersTable, // ✅ Needed for Clerk ID to UUID mapping
} from "../configs/schema.js";
import { eq, desc, sql, and } from "drizzle-orm";

// ✅ Create Review
export const createReview = async (req, res) => {
  try {
    const {
      name,
      rating,
      comment,
      photoUrls,
      productId,
      userId, // Clerk ID
    } = req.body;

    if (!rating || !comment || !productId || !userId) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // 🔄 Find user UUID from Clerk ID
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkId, userId));

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const internalUserId = user.id;

    // 🔍 Check if user has purchased the product
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

    const isVerified = previousPurchases.length > 0;

    // 📝 Insert review
    const [review] = await db
      .insert(reviewsTable)
      .values({
        name,
        userId: internalUserId, // ✅ UUID, not Clerk ID
        rating: parseInt(rating),
        comment,
        photoUrls,
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

// ✅ Get Reviews By Product
export const getReviewsByProduct = async (req, res) => {
  const { productId } = req.params;

  try {
    const reviews = await db
      .select()
      .from(reviewsTable)
      .where(eq(reviewsTable.productId, productId))
      .orderBy(desc(reviewsTable.createdAt));

    res.json(reviews);
  } catch (err) {
    console.error("❌ Failed to fetch reviews:", err);
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
      averageRating: parseFloat(stats.averageRating || 0),
      reviewCount: parseInt(stats.reviewCount || 0),
    });
  } catch (err) {
    console.error("❌ Failed to fetch review stats:", err);
    res.status(500).json({ error: "Server error" });
  }
};

// ✅ Check Verified Buyer
export const isVerifiedBuyer = async (req, res) => {
  const { userId, productId } = req.query; // Clerk ID

  try {
    // 🔄 Map Clerk ID to UUID
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkId, userId));

    if (!user) {
      return res.json({ verified: false });
    }

    const internalUserId = user.id;

    const orders = await db
      .select()
      .from(orderItemsTable)
      .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
      .where(
        and(
          eq(ordersTable.userId, internalUserId),
          eq(orderItemsTable.productId, productId)
        )
      );

    res.json({ verified: orders.length > 0 });
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

// ✅ Update Review
export const updateReview = async (req, res) => {
  const { id } = req.params;
  const { rating, comment, photoUrls } = req.body;

  try {
    const updated = await db
      .update(reviewsTable)
      .set({
        ...(rating && { rating: parseInt(rating) }),
        ...(comment && { comment }),
        ...(photoUrls && { photoUrls }),
        updatedAt: new Date(),
      })
      .where(eq(reviewsTable.id, id))
      .returning();

    res.json({ success: true, updated });
  } catch (err) {
    console.error("❌ Failed to update review:", err);
    res.status(500).json({ error: "Server error" });
  }
};
