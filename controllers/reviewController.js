import { db } from "../configs/index.js";
import { reviewsTable, orderItemsTable } from "../configs/schema.js";
import { eq, desc, sql, and } from "drizzle-orm";

export const createReview = async (req, res) => {
  try {
    const { name, rating, comment, photoUrls, productId, userId } = req.body;

    if (!rating || !comment || !productId) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const [review] = await db
      .insert(reviewsTable)
      .values({
        name,
        rating: parseInt(rating),
        comment,
        photoUrls,
        productId,
        userId,
        createdAt: new Date().toISOString(),
      })
      .returning();

    res.status(201).json(review);
  } catch (err) {
    console.error("❌ Failed to create review:", err);
    res.status(500).json({ error: "Server error" });
  }
};

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

export const isVerifiedBuyer = async (req, res) => {
  const { userId, productId } = req.query;

  try {
    const orders = await db
      .select()
      .from(orderItemsTable)
      .where(and(eq(orderItemsTable.userId, userId), eq(orderItemsTable.productId, productId)));

    res.json({ verified: orders.length > 0 });
  } catch (err) {
    console.error("❌ Failed to verify purchase:", err);
    res.status(500).json({ error: "Server error" });
  }
};

export const deleteReview = async (req, res) => {
  const { id } = req.params;

  try {
    const deleted = await db.delete(reviewsTable).where(eq(reviewsTable.id, id)).returning();
    res.json({ success: true, deleted });
  } catch (err) {
    console.error("❌ Failed to delete review:", err);
    res.status(500).json({ error: "Server error" });
  }
};

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
      })
      .where(eq(reviewsTable.id, id))
      .returning();

    res.json({ success: true, updated });
  } catch (err) {
    console.error("❌ Failed to update review:", err);
    res.status(500).json({ error: "Server error" });
  }
};
