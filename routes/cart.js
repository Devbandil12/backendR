import express from "express";
import { db } from "../configs/index.js";
import { addToCartTable, productsTable, wishlistTable } from "../configs/schema.js";
import { and, eq, inArray } from "drizzle-orm";

const router = express.Router();

// =========================
// Cart routes
// =========================

// GET /api/cart/:userId - Fetches all cart items for a specific user.
router.get("/:userId", async (req, res) => {
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

// POST /api/cart - Adds a single new product to a user's cart.
router.post("/", async (req, res) => {
  try {
    const { userId, productId, quantity } = req.body;
    console.log("Backend Received ->", { userId, productId, quantity }); // ✅ ADD THIS
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

// PUT /api/cart/:userId/:productId - Updates the quantity of an existing item in the cart.
router.put("/:userId/:productId", async (req, res) => {
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

// DELETE /api/cart/:userId/:productId - Removes a single specific item from the cart.
router.delete("/:userId/:productId", async (req, res) => {
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

// DELETE /api/cart/:userId - Clears all items from a user's cart.
router.delete("/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    await db.delete(addToCartTable).where(eq(addToCartTable.userId, userId));
    res.json({ success: true });
  } catch (error) {
    console.error("❌ Error clearing cart:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/cart/merge - Merges a guest's local cart with their account upon login.
router.post("/merge", async (req, res) => {
  const { userId, guestCart } = req.body;

  if (!userId || !Array.isArray(guestCart) || guestCart.length === 0) {
    return res.status(400).json({ error: "Invalid request body for cart merge" });
  }

  try {
    await db.transaction(async (tx) => {
      const guestProductIds = guestCart.map(item => item.productId);

      const existingCartItems = await tx.select()
        .from(addToCartTable)
        .where(and(
          eq(addToCartTable.userId, userId),
          inArray(addToCartTable.productId, guestProductIds)
        ));

      const existingProductIds = new Set(existingCartItems.map(item => item.productId));

      const promises = guestCart.map(guestItem => {
        if (existingProductIds.has(guestItem.productId)) {
          const existingItem = existingCartItems.find(item => item.productId === guestItem.productId);
          const newQuantity = existingItem.quantity + guestItem.quantity;
          return tx.update(addToCartTable)
            .set({ quantity: newQuantity })
            .where(and(eq(addToCartTable.userId, userId), eq(addToCartTable.productId, guestItem.productId)));
        } else {
          return tx.insert(addToCartTable).values({
            userId,
            productId: guestItem.productId,
            quantity: guestItem.quantity
          });
        }
      });
      await Promise.all(promises);
    });
    res.json({ success: true, message: "Guest cart merged successfully." });
  } catch (error) {
    console.error("❌ Error merging carts:", error);
    res.status(500).json({ error: "Server error while merging cart." });
  }
});

// =========================
// Wishlist routes
// =========================

// GET /api/cart/wishlist/:userId - Fetches all wishlist items for a specific user.
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

// POST /api/cart/wishlist - Adds a single product to a user's wishlist.
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

// DELETE /api/cart/wishlist/:userId/:productId - Removes a single specific item from the wishlist.
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

// POST /api/cart/wishlist/merge - Merges a guest's local wishlist with their account upon login.
router.post("/wishlist/merge", async (req, res) => {
  const { userId, guestWishlist } = req.body;

  if (!userId || !Array.isArray(guestWishlist) || guestWishlist.length === 0) {
    return res.status(400).json({ error: "Invalid request body for wishlist merge" });
  }

  try {
    await db.transaction(async (tx) => {
      const existingItems = await tx.select({ productId: wishlistTable.productId })
        .from(wishlistTable)
        .where(and(
          eq(wishlistTable.userId, userId),
          inArray(wishlistTable.productId, guestWishlist)
        ));

      const existingProductIds = new Set(existingItems.map(item => item.productId));

      const newProductIds = guestWishlist.filter(id => !existingProductIds.has(id));

      if (newProductIds.length > 0) {
        const newItemsToInsert = newProductIds.map(productId => ({ userId, productId }));
        await tx.insert(wishlistTable).values(newItemsToInsert);
      }
    });
    res.json({ success: true, message: "Guest wishlist merged successfully." });
  } catch (error) {
    console.error("❌ Error merging wishlists:", error);
    res.status(500).json({ error: "Server error while merging wishlist." });
  }
});

// DELETE /api/cart/wishlist/:userId - Clears all items from a user's wishlist.
router.delete("/wishlist/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    await db.delete(wishlistTable).where(eq(wishlistTable.userId, userId));
    res.json({ success: true });
  } catch (error) {
    console.error("❌ Error clearing wishlist:", error);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;