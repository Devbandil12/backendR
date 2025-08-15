import express from "express";
import { db } from "../configs/index.js";
import { addToCartTable, productsTable, wishlistTable } from "../configs/schema.js";
import { and, eq } from "drizzle-orm";

const router = express.Router();

// =========================
// Cart routes
// =========================

// Get user's cart
// The client-side logic (addToCart) will handle the check for existing items,
// and this route will simply perform the necessary DB operation.
router.get("/cart/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const cartItems = await db
      .select({
        product: productsTable,
        userId: addToCartTable.userId,
        cartId: addToCartTable.id,
        quantity: addToCartTable.quantity,
      })
      .from(addToCartTable)
      .innerJoin(productsTable, eq(addToCartTable.productId, productsTable.id))
      .where(eq(addToCartTable.userId, userId));

    res.json(cartItems);
  } catch (error) {
    console.error("❌ Error fetching cart:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Add a new item to cart
router.post("/cart", async (req, res) => {
  try {
    const { userId, productId, quantity } = req.body;
    const [newItem] = await db
      .insert(addToCartTable)
      .values({ userId, productId, quantity })
      .returning();

    res.json(newItem);
  } catch (error) {
    console.error("❌ Error adding to cart:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Update cart item quantity
router.put("/cart/:userId/:productId", async (req, res) => {
  try {
    const { userId, productId } = req.params;
    const { quantity } = req.body;

    await db
      .update(addToCartTable)
      .set({ quantity })
      .where(and(eq(addToCartTable.userId, userId), eq(addToCartTable.productId, productId)));
    
    res.json({ success: true });
  } catch (error) {
    console.error("❌ Error updating cart quantity:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Remove a specific item from cart
router.delete("/cart/:userId/:productId", async (req, res) => {
  try {
    const { userId, productId } = req.params;
    await db
      .delete(addToCartTable)
      .where(and(eq(addToCartTable.userId, userId), eq(addToCartTable.productId, productId)));

    res.json({ success: true });
  } catch (error) {
    console.error("❌ Error removing cart item:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Clear an entire user's cart
router.delete("/cart/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    await db.delete(addToCartTable).where(eq(addToCartTable.userId, userId));
    res.json({ success: true });
  } catch (error) {
    console.error("❌ Error clearing cart:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// =========================
// Wishlist routes
// =========================

// Get user's wishlist
router.get("/wishlist/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const wishlistItems = await db
      .select({
        product: productsTable,
        wishlistId: wishlistTable.id,
        userId: wishlistTable.userId,
        productId: wishlistTable.productId,
      })
      .from(wishlistTable)
      .innerJoin(productsTable, eq(wishlistTable.productId, productsTable.id))
      .where(eq(wishlistTable.userId, userId));

    res.json(wishlistItems);
  } catch (error) {
    console.error("❌ Error fetching wishlist:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Add item to wishlist
router.post("/wishlist", async (req, res) => {
  try {
    const { userId, productId } = req.body;
    const [newItem] = await db
      .insert(wishlistTable)
      .values({ userId, productId })
      .returning();

    res.json(newItem);
  } catch (error) {
    console.error("❌ Error adding to wishlist:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Remove item from wishlist
router.delete("/wishlist/:userId/:productId", async (req, res) => {
  try {
    const { userId, productId } = req.params;
    await db
      .delete(wishlistTable)
      .where(and(eq(wishlistTable.userId, userId), eq(wishlistTable.productId, productId)));
    res.json({ success: true });
  } catch (error) {
    console.error("❌ Error removing from wishlist:", error);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;

