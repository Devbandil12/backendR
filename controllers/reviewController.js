import { db } from "../configs/index.js";
import {
  reviewsTable,
  orderItemsTable,
  ordersTable,
  usersTable,
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

    // 🔍 Check if user has purchased the product (only if we have a user)