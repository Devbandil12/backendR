// routes/cart.js
import express from "express";
import { db } from "../configs/index.js";
import {
  addToCartTable,
  productsTable,
  productVariantsTable, // 🟢 ADDED
  wishlistTable,
  usersTable,
} from "../configs/schema.js";
import { and, eq, inArray, sql, desc, count, gt, lt } from "drizzle-orm";

import { cache } from "../cacheMiddleware.js";
import { invalidateMultiple } from "../invalidateHelpers.js";
import * as keys from "../cacheKeys.js"; // 🟢 Use 'keys' to avoid name conflicts

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
      // 🟢 MODIFIED: Join all three tables to build the correct item structure
      const cartItems = await db
        .select({
          quantity: addToCartTable.quantity,
          cartId: addToCartTable.id,
          userId: addToCartTable.userId,
          variant: productVariantsTable, // Get the full variant object
          product: productsTable,        // Get the full parent product object
        })
        .from(addToCartTable)
        .innerJoin(productVariantsTable, eq(addToCartTable.variantId, productVariantsTable.id))
        .innerJoin(productsTable, eq(productVariantsTable.productId, productsTable.id))
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
    // 🟢 MODIFIED: Receives variantId and productId
    const { userId, productId, variantId, quantity } = req.body;

    if (!userId || !productId || !variantId || !quantity) {
      return res.status(400).json({ error: "Missing required fields: userId, productId, variantId, quantity" });
    }

    const [newItem] = await db
      .insert(addToCartTable)
      .values({ userId, productId, variantId, quantity })
      .returning();

    await invalidateMultiple([{ key: keys.makeCartKey(userId) }]);

    res.json(newItem);
  } catch (error) {
    console.error("❌ Error adding to cart:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// 🟢 PUT /api/cart/:userId/:variantId — Update quantity
router.put("/:userId/:variantId", async (req, res) => {
  try {
    // 🟢 MODIFIED: Uses variantId
    const { userId, variantId } = req.params;
    const { quantity } = req.body;

    await db
      .update(addToCartTable)
      .set({ quantity })
      .where(
        and(
          eq(addToCartTable.userId, userId),
          eq(addToCartTable.variantId, variantId) // 🟢 MODIFIED
        )
      );

    await invalidateMultiple([{ key: keys.makeCartKey(userId) }]);

    res.json({ success: true });
  } catch (error) {
    console.error("❌ Error updating cart quantity:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// 🟢 DELETE /api/cart/:userId/:variantId — Remove one product
router.delete("/:userId/:variantId", async (req, res) => {
  try {
    // 🟢 MODIFIED: Uses variantId
    const { userId, variantId } = req.params;

    await db
      .delete(addToCartTable)
      .where(
        and(
          eq(addToCartTable.userId, userId),
          eq(addToCartTable.variantId, variantId) // 🟢 MODIFIED
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
  const { userId, guestCart } = req.body; // 🟢 guestCart: [{ variantId, quantity, productId }]

  if (!userId || !Array.isArray(guestCart) || guestCart.length === 0) {
    return res
      .status(400)
      .json({ error: "Invalid request body for cart merge" });
  }

  try {
    await db.transaction(async (tx) => {
      // 🟢 MODIFIED: Use variantId
      const guestVariantIds = guestCart.map((item) => item.variantId);
      const existingCartItems = await tx
        .select()
        .from(addToCartTable)
        .where(
          and(
            eq(addToCartTable.userId, userId),
            inArray(addToCartTable.variantId, guestVariantIds) // 🟢 MODIFIED
          )
        );

      const existingVariantIds = new Set(
        existingCartItems.map((item) => item.variantId)
      );

      const promises = guestCart.map((guestItem) => {
        if (existingVariantIds.has(guestItem.variantId)) {
          // Update quantity for existing item
          const existingItem = existingCartItems.find(
            (item) => item.variantId === guestItem.variantId
          );
          const newQuantity = existingItem.quantity + guestItem.quantity;
          return tx
            .update(addToCartTable)
            .set({ quantity: newQuantity })
            .where(
              and(
                eq(addToCartTable.userId, userId),
                eq(addToCartTable.variantId, guestItem.variantId) // 🟢 MODIFIED
              )
            );
        } else {
          // Insert new item
          return tx.insert(addToCartTable).values({
            userId,
            productId: guestItem.productId, // 🟢 Pass productId
            variantId: guestItem.variantId, // 🟢 Pass variantId
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
      // 🟢 MODIFIED: Join all three tables
      const wishlistItems = await db
        .select({
          wishlistId: wishlistTable.id,
          userId: wishlistTable.userId,
          variantId: wishlistTable.variantId,
          variant: productVariantsTable,
          product: productsTable,
        })
        .from(wishlistTable)
        .innerJoin(productVariantsTable, eq(wishlistTable.variantId, productVariantsTable.id))
        .innerJoin(productsTable, eq(productVariantsTable.productId, productsTable.id))
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
    // 🟢 MODIFIED: Receives variantId and productId
    const { userId, productId, variantId } = req.body;
    if (!userId || !productId || !variantId) {
      return res.status(400).json({ error: "Missing required fields: userId, productId, variantId" });
    }
    const [newItem] = await db
      .insert(wishlistTable)
      .values({ userId, productId, variantId })
      .returning();

    await invalidateMultiple([{ key: keys.makeWishlistKey(userId) }]);
    res.json(newItem);
  } catch (error) {
    console.error("❌ Error adding to wishlist:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// 🟢 DELETE /api/cart/wishlist/:userId/:variantId — Remove item
router.delete("/wishlist/:userId/:variantId", async (req, res) => {
  try {
    // 🟢 MODIFIED: Uses variantId
    const { userId, variantId } = req.params;

    await db
      .delete(wishlistTable)
      .where(
        and(
          eq(wishlistTable.userId, userId),
          eq(wishlistTable.variantId, variantId) // 🟢 MODIFIED
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
  const { userId, guestWishlist } = req.body; // 🟢 guestWishlist: [{variantId, productId}]

  if (!userId || !Array.isArray(guestWishlist) || guestWishlist.length === 0) {
    return res
      .status(400)
      .json({ error: "Invalid request body for wishlist merge" });
  }

  try {
    await db.transaction(async (tx) => {
      // 🟢 MODIFIED: Use variantId
      const guestVariantIds = guestWishlist.map(item => item.variantId);
      const existingItems = await tx
        .select({ variantId: wishlistTable.variantId })
        .from(wishlistTable)
        .where(
          and(
            eq(wishlistTable.userId, userId),
            inArray(wishlistTable.variantId, guestVariantIds) // 🟢 MODIFIED
          )
        );

      const existingIds = new Set(existingItems.map((i) => i.variantId));
      const newItems = guestWishlist.filter((item) => !existingIds.has(item.variantId));

      if (newItems.length > 0) {
        await tx.insert(wishlistTable).values(
          newItems.map((item) => ({
            userId,
            productId: item.productId, // 🟢 Pass productId
            variantId: item.variantId, // 🟢 Pass variantId
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

/* =========================================================
   👑 ADMIN ROUTES
========================================================= */

router.get("/admin/abandoned", async (req, res) => {
  try {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // 🟢 MODIFIED: Join all three tables
    const abandonedItems = await db
      .select({
        cartItem: addToCartTable,
        user: {
          id: usersTable.id,
          name: usersTable.name,
          email: usersTable.email,
        },
        product: productsTable,
        variant: productVariantsTable,
      })
      .from(addToCartTable)
      .innerJoin(usersTable, eq(addToCartTable.userId, usersTable.id))
      .innerJoin(productVariantsTable, eq(addToCartTable.variantId, productVariantsTable.id)) // 🟢 MODIFIED
      .innerJoin(productsTable, eq(productVariantsTable.productId, productsTable.id)) // 🟢 MODIFIED
      .where(
        and(
          lt(addToCartTable.addedAt, twoHoursAgo),
          gt(addToCartTable.addedAt, thirtyDaysAgo)
        )
      )
      .orderBy(desc(addToCartTable.addedAt));

    res.json(abandonedItems);

  } catch (error) {
    console.error("❌ Error fetching abandoned carts:", error);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/admin/wishlist-stats", async (req, res) => {
  try {
    const stats = await db
      .select({
        // 🟢 FIXED: Get productId from the productVariantsTable
        productId: productVariantsTable.productId,
        variantId: wishlistTable.variantId,
        productName: productsTable.name,
        variantName: productVariantsTable.name,
        productImage: sql`(${productsTable.imageurl}) ->> 0`.as("productImage"),
        count: count(wishlistTable.variantId),
      })
      .from(wishlistTable)
      .innerJoin(productVariantsTable, eq(wishlistTable.variantId, productVariantsTable.id))
      .innerJoin(productsTable, eq(productVariantsTable.productId, productsTable.id))
      .groupBy(
        // 🟢 FIXED: Group by the correct table's column
        productVariantsTable.productId,
        wishlistTable.variantId,
        productsTable.name,
        productVariantsTable.name,
        sql`(${productsTable.imageurl}) ->> 0`
      )
      .orderBy(desc(count(wishlistTable.variantId)))
      .limit(20);

    res.json(stats);
  } catch (error) {
    console.error("❌ Error fetching wishlist stats:", error);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;