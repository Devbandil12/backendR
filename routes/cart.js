// routes/cart.js
import express from "express";
import { db } from "../configs/index.js";
import {
  addToCartTable,
  productsTable,
  wishlistTable,
  usersTable,
} from "../configs/schema.js";
import { and, eq, inArray, sql, desc, count, gt, lt } from "drizzle-orm";

import { cache } from "../cacheMiddleware.js";
import { invalidateMultiple } from "../invalidateHelpers.js";
import * as keys from "../cacheKeys.js";

const router = express.Router();

/* =========================================================
   🛒 CART ROUTES
========================================================= */

// 🟢 GET /api/cart/:userId — Get all cart items for a user
router.get(
  "/:userId",
  cache((req) => keys.makeCartKey(req.params.userId), 300),
  async (req, res) => {
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
  }
);

// 🟢 POST /api/cart — Add product to cart
router.post("/", async (req, res) => {
  try {
    const { userId, productId, quantity } = req.body;

    const [newItem] = await db
      .insert(addToCartTable)
      .values({ userId, productId, quantity })
      .returning();

    await invalidateMultiple([{ key: keys.makeCartKey(userId) }]);

    res.json(newItem);
  } catch (error) {
    console.error("❌ Error adding to cart:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// 🟢 PUT /api/cart/:userId/:productId — Update quantity
router.put("/:userId/:productId", async (req, res) => {
  try {
    const { userId, productId } = req.params;
    const { quantity } = req.body;

    await db
      .update(addToCartTable)
      .set({ quantity })
      .where(
        and(
          eq(addToCartTable.userId, userId),
          eq(addToCartTable.productId, productId)
        )
      );

    await invalidateMultiple([{ key: keys.makeCartKey(userId) }]);

    res.json({ success: true });
  } catch (error) {
    console.error("❌ Error updating cart quantity:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// 🟢 DELETE /api/cart/:userId/:productId — Remove one product
router.delete("/:userId/:productId", async (req, res) => {
  try {
    const { userId, productId } = req.params;

    await db
      .delete(addToCartTable)
      .where(
        and(
          eq(addToCartTable.userId, userId),
          eq(addToCartTable.productId, productId)
        )
      );

    await invalidateMultiple([{ key: keys.makeCartKey(userId) }]);

    res.json({ success: true });
  } catch (error) {
    console.error("❌ Error removing cart item:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// 🟢 DELETE /api/cart/:userId — Clear all items
router.delete("/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    await db.delete(addToCartTable).where(eq(addToCartTable.userId, userId));

    await invalidateMultiple([{ key: keys.makeCartKey(userId) }]);

    res.json({ success: true });
  } catch (error) {
    console.error("❌ Error clearing cart:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// 🟢 POST /api/cart/merge — Merge guest cart with user
router.post("/merge", async (req, res) => {
  const { userId, guestCart } = req.body;

  if (!userId || !Array.isArray(guestCart) || guestCart.length === 0) {
    return res
      .status(400)
      .json({ error: "Invalid request body for cart merge" });
  }

  try {
    await db.transaction(async (tx) => {
      const guestProductIds = guestCart.map((item) => item.productId);
      const existingCartItems = await tx
        .select()
        .from(addToCartTable)
        .where(
          and(
            eq(addToCartTable.userId, userId),
            inArray(addToCartTable.productId, guestProductIds)
          )
        );

      const existingProductIds = new Set(
        existingCartItems.map((item) => item.productId)
      );

      const promises = guestCart.map((guestItem) => {
        if (existingProductIds.has(guestItem.productId)) {
          const existingItem = existingCartItems.find(
            (item) => item.productId === guestItem.productId
          );
          const newQuantity = existingItem.quantity + guestItem.quantity;
          return tx
            .update(addToCartTable)
            .set({ quantity: newQuantity })
            .where(
              and(
                eq(addToCartTable.userId, userId),
                eq(addToCartTable.productId, guestItem.productId)
              )
            );
        } else {
          return tx.insert(addToCartTable).values({
            userId,
            productId: guestItem.productId,
            quantity: guestItem.quantity,
          });
        }
      });
      await Promise.all(promises);
    });

    await invalidateMultiple([{ key: keys.makeCartKey(userId) }]);

    res.json({ success: true, message: "Guest cart merged successfully." });
  } catch (error) {
    console.error("❌ Error merging carts:", error);
    res.status(500).json({ error: "Server error while merging cart." });
  }
});

/* =========================================================
   💖 WISHLIST ROUTES
========================================================= */

// 🟢 GET /api/cart/wishlist/:userId — Get wishlist items
router.get(
  "/wishlist/:userId",
  cache((req) => keys.makeWishlistKey(req.params.userId), 300),
  async (req, res) => {
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
        .innerJoin(
          productsTable,
          eq(wishlistTable.productId, productsTable.id)
        )
        .where(eq(wishlistTable.userId, userId));

      res.json(wishlistItems);
    } catch (error) {
      console.error("❌ Error fetching wishlist:", error);
      res.status(500).json({ error: "Server error" });
    }
  }
);

// 🟢 POST /api/cart/wishlist — Add product to wishlist
router.post("/wishlist", async (req, res) => {
  try {
    const { userId, productId } = req.body;
    const [newItem] = await db
      .insert(wishlistTable)
      .values({ userId, productId })
      .returning();

    await invalidateMultiple([{ key: keys.makeWishlistKey(userId) }]);

    res.json(newItem);
  } catch (error) {
    console.error("❌ Error adding to wishlist:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// 🟢 DELETE /api/cart/wishlist/:userId/:productId — Remove item
router.delete("/wishlist/:userId/:productId", async (req, res) => {
  try {
    const { userId, productId } = req.params;

    await db
      .delete(wishlistTable)
      .where(
        and(
          eq(wishlistTable.userId, userId),
          eq(wishlistTable.productId, productId)
        )
      );

    await invalidateMultiple([{ key: keys.makeWishlistKey(userId) }]);

    res.json({ success: true });
  } catch (error) {
    console.error("❌ Error removing wishlist item:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// 🟢 POST /api/cart/wishlist/merge — Merge guest wishlist
router.post("/wishlist/merge", async (req, res) => {
  const { userId, guestWishlist } = req.body;

  if (!userId || !Array.isArray(guestWishlist) || guestWishlist.length === 0) {
    return res
      .status(400)
      .json({ error: "Invalid request body for wishlist merge" });
  }

  try {
    await db.transaction(async (tx) => {
      const existingItems = await tx
        .select({ productId: wishlistTable.productId })
        .from(wishlistTable)
        .where(
          and(
            eq(wishlistTable.userId, userId),
            inArray(wishlistTable.productId, guestWishlist)
          )
        );

      const existingIds = new Set(existingItems.map((i) => i.productId));
      const newIds = guestWishlist.filter((id) => !existingIds.has(id));

      if (newIds.length > 0) {
        await tx.insert(wishlistTable).values(
          newIds.map((productId) => ({
            userId,
            productId,
          }))
        );
      }
    });

    await invalidateMultiple([{ key: keys.makeWishlistKey(userId) }]);

    res.json({ success: true, message: "Guest wishlist merged successfully." });
  } catch (error) {
    console.error("❌ Error merging wishlist:", error);
    res
      .status(500)
      .json({ error: "Server error while merging wishlist." });
  }
});

// 🟢 DELETE /api/cart/wishlist/:userId — Clear wishlist
router.delete("/wishlist/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    await db.delete(wishlistTable).where(eq(wishlistTable.userId, userId));

    await invalidateMultiple([{ key: keys.makeWishlistKey(userId) }]);

    res.json({ success: true });
  } catch (error) {
    console.error("❌ Error clearing wishlist:", error);
    res.status(500).json({ error: "Server error" });
  }
});


router.get("/admin/abandoned", async (req, res) => {
  try {
    // Define "abandoned" time range
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const abandonedItems = await db
      .select({
        cartItem: addToCartTable,
        user: {
          id: usersTable.id,
          name: usersTable.name,
          email: usersTable.email,
        },
        product: productsTable,
      })
      .from(addToCartTable)
      .innerJoin(usersTable, eq(addToCartTable.userId, usersTable.id))
      .innerJoin(productsTable, eq(addToCartTable.productId, productsTable.id))
      .where(
        and(
          lt(addToCartTable.addedAt, twoHoursAgo),
          gt(addToCartTable.addedAt, thirtyDaysAgo)
        )
      )
      .orderBy(desc(addToCartTable.addedAt));

    // 🟢 We will group these on the frontend
    res.json(abandonedItems);

  } catch (error) {
    console.error("❌ Error fetching abandoned carts:", error);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * 🟢 GET /api/cart/admin/wishlist-stats
 * Fetches the most popular wishlist items
 */
router.get("/admin/wishlist-stats", async (req, res) => {
  try {
    const stats = await db
      .select({
        productId: wishlistTable.productId,
        productName: productsTable.name,
        productImage: sql`(${productsTable.imageurl}) ->> 0`.as("productImage"), // Get first image
        count: count(wishlistTable.productId),
      })
      .from(wishlistTable)
      .innerJoin(productsTable, eq(wishlistTable.productId, productsTable.id))
      .groupBy(
        wishlistTable.productId,
        productsTable.name,
        sql`(${productsTable.imageurl}) ->> 0`
      )
      .orderBy(desc(count(wishlistTable.productId)))
      .limit(20); // Get top 20

    res.json(stats);
  } catch (error) {
    console.error("❌ Error fetching wishlist stats:", error);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
