import { db } from "../configs/index.js";
import { reviewsTable } from "../configs/schema.js";
import { eq, desc, sql } from "drizzle-orm";

export const createReview = async (req, res) => {
  try {
    const { name, rating, comment, photoUrl, productId } = req.body;

    if (!name || !rating || !comment || !productId) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const [review] = await db
      .insert(reviewsTable)
      .values({
        name,
        rating: parseInt(rating),
        comment,
        photoUrl,
        productId,
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
