// routes/cart.js
import express from "express";
import { db } from "../configs/index.js";
import {
  addToCartTable,
  productsTable,
  productVariantsTable,
  wishlistTable,
  usersTable,
  productBundlesTable, 
  savedForLaterTable 
} from "../configs/schema.js";
import { and, eq, inArray, sql, desc, count, gt, lt } from "drizzle-orm";

import { invalidateMultiple } from "../invalidateHelpers.js";
import * as keys from "../cacheKeys.js";

// 🟢 FIXED: Removed unused 'cache' import that caused the crash
const router = express.Router();

/* =========================================================
   🛒 CART ROUTES
========================================================= */

// GET /api/cart/:userId — Get all cart items for a user
router.get(
  "/:userId",
  // 🟢 FIXED: Removed cache middleware for live updates
  async (req, res) => {
    try {
      const { userId } = req.params;
      const cartItems = await db.query.addToCartTable.findMany({
          where: eq(addToCartTable.userId, userId),
          with: {
              variant: { with: { product: true } }
          }
      });

      const detailedCartItems = await Promise.all(cartItems.map(async (item) => {
        const bundleContents = await db.query.productBundlesTable.findMany({
          where: eq(productBundlesTable.bundleVariantId, item.variantId),
          with: {
            content: { 
              with: {
                product: true 
              }
            }
          }
        });

        if (bundleContents.length > 0) {
          return {
            ...item,
            isBundle: true,
            contents: bundleContents.map(c => ({
              quantity: c.quantity,
              name: c.content.product.name,
              variantName: c.content.name
            }))
          };
        }
        
        return { ...item, isBundle: false };
      }));

      const finalItems = detailedCartItems.map(item => ({
         quantity: item.quantity,
         cartId: item.id,
         userId: item.userId,
         variant: item.variant,
         product: item.variant.product,
         isBundle: item.isBundle,
         contents: item.contents || []
      }));

      res.json(finalItems);
    } catch (error) {
      console.error("❌ Error fetching cart:", error);
      res.status(500).json({ error: "Server error" });
    }
  }
);

// POST /api/cart — Add product to cart
router.post("/", async (req, res) => {
  try {
    const { userId, productId, variantId, quantity } = req.body;

    if (!userId || !productId || !variantId || !quantity) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const [newItem] = await db
      .insert(addToCartTable)
      .values({ 
        userId, 
        variantId, 
        quantity 
      })
      .returning();

    await invalidateMultiple([{ key: keys.makeCartKey(userId) }]);

    res.json(newItem);
  } catch (error) {
    console.error("❌ Error adding to cart:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// PUT /api/cart/:userId/:variantId — Update quantity
router.put("/:userId/:variantId", async (req, res) => {
  try {
    const { userId, variantId } = req.params;
    const { quantity } = req.body;

    await db
      .update(addToCartTable)
      .set({ quantity })
      .where(
        and(
          eq(addToCartTable.userId, userId),
          eq(addToCartTable.variantId, variantId)
        )
      );

    await invalidateMultiple([{ key: keys.makeCartKey(userId) }]);

    res.json({ success: true });
  } catch (error) {
    console.error("❌ Error updating cart quantity:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// DELETE /api/cart/:userId/:variantId — Remove one product
router.delete("/:userId/:variantId", async (req, res) => {
  try {
    const { userId, variantId } = req.params;

    await db
      .delete(addToCartTable)
      .where(
        and(
          eq(addToCartTable.userId, userId),
          eq(addToCartTable.variantId, variantId)
        )
      );

    await invalidateMultiple([{ key: keys.makeCartKey(userId) }]);

    res.json({ success: true });
  } catch (error) {
    console.error("❌ Error removing cart item:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// DELETE /api/cart/:userId — Clear all items
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

// POST /api/cart/merge — Merge guest cart with user
router.post("/merge", async (req, res) => {
  const { userId, guestCart } = req.body;

  if (!userId || !Array.isArray(guestCart) || guestCart.length === 0) {
    return res
      .status(400)
      .json({ error: "Invalid request body for cart merge" });
  }

  try {
    await db.transaction(async (tx) => {
      const guestVariantIds = guestCart.map((item) => item.variantId);
      const existingCartItems = await tx
        .select()
        .from(addToCartTable)
        .where(
          and(
            eq(addToCartTable.userId, userId),
            inArray(addToCartTable.variantId, guestVariantIds)
          )
        );

      const existingVariantIds = new Set(
        existingCartItems.map((item) => item.variantId)
      );

      const promises = guestCart.map((guestItem) => {
        if (existingVariantIds.has(guestItem.variantId)) {
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
                eq(addToCartTable.variantId, guestItem.variantId)
              )
            );
        } else {
          return tx.insert(addToCartTable).values({
            userId,
            variantId: guestItem.variantId, 
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
   🕒 SAVED FOR LATER ROUTES
========================================================= */

// GET /api/cart/saved-for-later/:userId
router.get("/saved-for-later/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const savedItems = await db.query.savedForLaterTable.findMany({
      where: eq(savedForLaterTable.userId, userId),
      with: {
        variant: { with: { product: true } },
      },
    });
    
    // Transform to match frontend expectations
    const formatted = savedItems.map(item => ({
      ...item,
      product: item.variant.product,
    }));

    res.json(formatted);
  } catch (error) {
    console.error("❌ Error fetching saved items:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/cart/save-for-later
router.post("/save-for-later", async (req, res) => {
  const { userId, variantId, quantity } = req.body;
  if (!userId || !variantId) return res.status(400).json({ error: "Missing fields" });

  try {
    await db.transaction(async (tx) => {
      // 1. Remove from Cart
      await tx.delete(addToCartTable).where(
        and(eq(addToCartTable.userId, userId), eq(addToCartTable.variantId, variantId))
      );

      // 2. Check if THIS variant is already in Saved
      const existing = await tx.query.savedForLaterTable.findFirst({
        where: and(
          eq(savedForLaterTable.userId, userId),
          eq(savedForLaterTable.variantId, variantId)
        ),
      });

      // 3. Insert or Update Saved
      if (existing) {
        await tx.update(savedForLaterTable)
          .set({ quantity: existing.quantity + (quantity || 1) })
          .where(eq(savedForLaterTable.id, existing.id));
      } else {
        await tx.insert(savedForLaterTable).values({
          userId,
          variantId,
          quantity: quantity || 1,
        });
      }
    });

    await invalidateMultiple([{ key: keys.makeCartKey(userId) }]);
    res.json({ success: true });
  } catch (error) {
    console.error("❌ Error saving for later:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/cart/move-to-cart
router.post("/move-to-cart", async (req, res) => {
  const { userId, variantId, quantity } = req.body;
  if (!userId || !variantId) return res.status(400).json({ error: "Missing fields" });

  try {
    await db.transaction(async (tx) => {
      // 1. Remove from Saved
      await tx.delete(savedForLaterTable).where(
        and(eq(savedForLaterTable.userId, userId), eq(savedForLaterTable.variantId, variantId))
      );

      // 2. Check if already in Cart
      const existing = await tx.query.addToCartTable.findFirst({
        where: and(eq(addToCartTable.userId, userId), eq(addToCartTable.variantId, variantId)),
      });

      // 3. Insert or Update Cart
      if (existing) {
        await tx.update(addToCartTable)
          .set({ quantity: existing.quantity + (quantity || 1) })
          .where(eq(addToCartTable.id, existing.id));
      } else {
        await tx.insert(addToCartTable).values({
          userId,
          variantId,
          quantity: quantity || 1,
        });
      }
    });

    await invalidateMultiple([{ key: keys.makeCartKey(userId) }]);
    res.json({ success: true });
  } catch (error) {
    console.error("❌ Error moving to cart:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// DELETE /api/cart/saved-for-later/:userId/:variantId
router.delete("/saved-for-later/:userId/:variantId", async (req, res) => {
  try {
    const { userId, variantId } = req.params;
    await db.delete(savedForLaterTable).where(
      and(eq(savedForLaterTable.userId, userId), eq(savedForLaterTable.variantId, variantId))
    );
    res.json({ success: true });
  } catch (error) {
    console.error("❌ Error removing saved item:", error);
    res.status(500).json({ error: "Server error" });
  }
});

/* =========================================================
   💖 WISHLIST ROUTES
========================================================= */

// GET /api/cart/wishlist/:userId
router.get(
  "/wishlist/:userId",
  // 🟢 FIXED: Removed 'cache(...)' middleware here too, to fix ReferenceError
  async (req, res) => {
    try {
      const { userId } = req.params;
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

// POST /api/cart/wishlist
router.post("/wishlist", async (req, res) => {
  try {
    const { userId, productId, variantId } = req.body;
    if (!userId || !productId || !variantId) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    const [newItem] = await db
      .insert(wishlistTable)
      .values({ 
        userId, 
        variantId 
      })
      .returning();

    await invalidateMultiple([{ key: keys.makeWishlistKey(userId) }]);
    res.json(newItem);
  } catch (error) {
    console.error("❌ Error adding to wishlist:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// DELETE /api/cart/wishlist/:userId/:variantId
router.delete("/wishlist/:userId/:variantId", async (req, res) => {
  try {
    const { userId, variantId } = req.params;

    await db
      .delete(wishlistTable)
      .where(
        and(
          eq(wishlistTable.userId, userId),
          eq(wishlistTable.variantId, variantId)
        )
      );

    await invalidateMultiple([{ key: keys.makeWishlistKey(userId) }]);
    res.json({ success: true });
  } catch (error)
    {
    console.error("❌ Error removing wishlist item:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/cart/wishlist/merge
router.post("/wishlist/merge", async (req, res) => {
  const { userId, guestWishlist } = req.body;

  if (!userId || !Array.isArray(guestWishlist) || guestWishlist.length === 0) {
    return res
      .status(400)
      .json({ error: "Invalid request body for wishlist merge" });
  }

  try {
    await db.transaction(async (tx) => {
      const guestVariantIds = guestWishlist.map(item => item.variantId);
      const existingItems = await tx
        .select({ variantId: wishlistTable.variantId })
        .from(wishlistTable)
        .where(
          and(
            eq(wishlistTable.userId, userId),
            inArray(wishlistTable.variantId, guestVariantIds)
          )
        );

      const existingIds = new Set(existingItems.map((i) => i.variantId));
      const newItems = guestWishlist.filter((item) => !existingIds.has(item.variantId));

      if (newItems.length > 0) {
        await tx.insert(wishlistTable).values(
          newItems.map((item) => ({
            userId,
            variantId: item.variantId, 
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

// DELETE /api/cart/wishlist/:userId
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
      .innerJoin(productVariantsTable, eq(addToCartTable.variantId, productVariantsTable.id))
      .innerJoin(productsTable, eq(productVariantsTable.productId, productsTable.id))
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

router.post("/add-custom-bundle", async (req, res) => {
  const { userId, templateVariantId, contentVariantIds } = req.body;

  if (!userId || !templateVariantId || !Array.isArray(contentVariantIds) || contentVariantIds.length !== 4) {
    return res.status(400).json({ error: "Invalid bundle data." });
  }

  try {
    const newCustomBundle = await db.transaction(async (tx) => {
      const templateVariant = await tx.query.productVariantsTable.findFirst({
        where: eq(productVariantsTable.id, templateVariantId),
      });

      if (!templateVariant) throw new Error("Template variant not found.");

      const [newVariant] = await tx.insert(productVariantsTable).values({
        productId: templateVariant.productId,
        name: `Custom Combo - ${userId.slice(0, 8)}`, 
        size: templateVariant.size,
        oprice: templateVariant.oprice,
        discount: templateVariant.discount,
        costPrice: templateVariant.costPrice,
        stock: 1, 
        isArchived: true, 
      }).returning();

      const bundleEntries = contentVariantIds.map(contentId => ({
        bundleVariantId: newVariant.id,
        contentVariantId: contentId,
        quantity: 1,
      }));
      await tx.insert(productBundlesTable).values(bundleEntries);

      const [cartItem] = await tx.insert(addToCartTable).values({
        userId: userId,
        variantId: newVariant.id,
        quantity: 1,
      }).returning();

      return cartItem;
    });
    
    await invalidateMultiple([{ key: keys.makeCartKey(userId) }]);
    res.status(201).json(newCustomBundle);

  } catch (error) {
    console.error("❌ Error creating custom bundle:", error);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;