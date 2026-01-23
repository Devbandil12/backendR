// ✅ file: routes/cart.js
import express from "express";
import { db } from "../configs/index.js";
import {
  addToCartTable,
  productsTable,
  productVariantsTable,
  wishlistTable,
  usersTable,
  productBundlesTable, 
  savedForLaterTable,
  reviewsTable
} from "../configs/schema.js";
import { and, eq, inArray, sql, desc, count, gt, lt } from "drizzle-orm";

import { invalidateMultiple } from "../invalidateHelpers.js";
import * as keys from "../cacheKeys.js";

// 🔒 SECURITY: Import Middleware
import { requireAuth, verifyAdmin } from "../middleware/authMiddleware.js";

const router = express.Router();

/* =========================================================
   🛒 CART ROUTES (Secured)
========================================================= */

// GET /api/cart/:userId
router.get("/:userId", requireAuth, async (req, res) => {
    try {
      const { userId } = req.params;
      const requesterClerkId = req.auth.userId;

      // 1. Resolve & Verify User
      const requester = await db.query.usersTable.findFirst({
          where: eq(usersTable.clerkId, requesterClerkId),
          columns: { id: true, role: true }
      });
      if (!requester) return res.status(401).json({ error: "Unauthorized" });

      // 🔒 ACL: Only allow Owner or Admin
      if (requester.id !== userId && requester.role !== 'admin') {
          return res.status(403).json({ error: "Forbidden" });
      }

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
              with: { product: true }
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

// POST /api/cart — Add product
router.post("/", requireAuth, async (req, res) => {
  try {
    const { productId, variantId, quantity } = req.body;
    const requesterClerkId = req.auth.userId;

    // 🔒 Security: Resolve User ID from Token
    const user = await db.query.usersTable.findFirst({
        where: eq(usersTable.clerkId, requesterClerkId)
    });
    if (!user) return res.status(401).json({ error: "User not found" });
    const userId = user.id;

    if (!productId || !variantId || !quantity) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const [newItem] = await db
      .insert(addToCartTable)
      .values({ 
        userId, // 🔒 Forced
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
router.put("/:userId/:variantId", requireAuth, async (req, res) => {
  try {
    const { userId, variantId } = req.params;
    const { quantity } = req.body;
    const requesterClerkId = req.auth.userId;

    // 🔒 ACL Check
    const user = await db.query.usersTable.findFirst({
        where: eq(usersTable.clerkId, requesterClerkId)
    });
    if (!user || user.id !== userId) return res.status(403).json({ error: "Forbidden" });

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

// DELETE /api/cart/:userId/:variantId
router.delete("/:userId/:variantId", requireAuth, async (req, res) => {
  try {
    const { userId, variantId } = req.params;
    const requesterClerkId = req.auth.userId;

    // 🔒 ACL Check
    const user = await db.query.usersTable.findFirst({
        where: eq(usersTable.clerkId, requesterClerkId)
    });
    if (!user || user.id !== userId) return res.status(403).json({ error: "Forbidden" });

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

// DELETE /api/cart/:userId — Clear Cart
router.delete("/:userId", requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const requesterClerkId = req.auth.userId;

    // 🔒 ACL Check
    const user = await db.query.usersTable.findFirst({
        where: eq(usersTable.clerkId, requesterClerkId)
    });
    if (!user || user.id !== userId) return res.status(403).json({ error: "Forbidden" });

    await db.delete(addToCartTable).where(eq(addToCartTable.userId, userId));
    await invalidateMultiple([{ key: keys.makeCartKey(userId) }]);
    res.json({ success: true });
  } catch (error) {
    console.error("❌ Error clearing cart:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/cart/merge
router.post("/merge", requireAuth, async (req, res) => {
  const { guestCart } = req.body;
  const requesterClerkId = req.auth.userId;

  try {
    // 🔒 Security: Resolve User ID
    const user = await db.query.usersTable.findFirst({
        where: eq(usersTable.clerkId, requesterClerkId)
    });
    if (!user) return res.status(401).json({ error: "User not found" });
    const userId = user.id;

    if (!Array.isArray(guestCart) || guestCart.length === 0) {
      return res.status(400).json({ error: "Invalid request body" });
    }

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
   🕒 SAVED FOR LATER ROUTES (Secured)
========================================================= */

// GET /api/cart/saved-for-later/:userId
router.get("/saved-for-later/:userId", requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const requesterClerkId = req.auth.userId;

    // 🔒 ACL Check
    const user = await db.query.usersTable.findFirst({
        where: eq(usersTable.clerkId, requesterClerkId)
    });
    if (!user || user.id !== userId) return res.status(403).json({ error: "Forbidden" });

    const savedItems = await db.query.savedForLaterTable.findMany({
      where: eq(savedForLaterTable.userId, userId),
      with: {
        variant: { with: { product: true } },
      },
    });

    const detailedSavedItems = await Promise.all(savedItems.map(async (item) => {
        const bundleContents = await db.query.productBundlesTable.findMany({
          where: eq(productBundlesTable.bundleVariantId, item.variantId),
          with: {
            content: { with: { product: true } }
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
        return { ...item, isBundle: false, contents: [] };
    }));
    
    const formatted = detailedSavedItems.map(item => ({
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
router.post("/save-for-later", requireAuth, async (req, res) => {
  try {
    const { variantId, quantity } = req.body;
    const requesterClerkId = req.auth.userId;

    // 🔒 Security: Resolve User
    const user = await db.query.usersTable.findFirst({
        where: eq(usersTable.clerkId, requesterClerkId)
    });
    if (!user) return res.status(401).json({ error: "User not found" });
    const userId = user.id;

    if (!variantId) return res.status(400).json({ error: "Missing variantId" });

    await db.transaction(async (tx) => {
      await tx.delete(addToCartTable).where(
        and(eq(addToCartTable.userId, userId), eq(addToCartTable.variantId, variantId))
      );

      const existing = await tx.query.savedForLaterTable.findFirst({
        where: and(
          eq(savedForLaterTable.userId, userId),
          eq(savedForLaterTable.variantId, variantId)
        ),
      });

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
router.post("/move-to-cart", requireAuth, async (req, res) => {
  try {
    const { variantId, quantity } = req.body;
    const requesterClerkId = req.auth.userId;

    // 🔒 Security: Resolve User
    const user = await db.query.usersTable.findFirst({
        where: eq(usersTable.clerkId, requesterClerkId)
    });
    if (!user) return res.status(401).json({ error: "User not found" });
    const userId = user.id;

    if (!variantId) return res.status(400).json({ error: "Missing variantId" });

    await db.transaction(async (tx) => {
      await tx.delete(savedForLaterTable).where(
        and(eq(savedForLaterTable.userId, userId), eq(savedForLaterTable.variantId, variantId))
      );

      const existing = await tx.query.addToCartTable.findFirst({
        where: and(eq(addToCartTable.userId, userId), eq(addToCartTable.variantId, variantId)),
      });

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
router.delete("/saved-for-later/:userId/:variantId", requireAuth, async (req, res) => {
  try {
    const { userId, variantId } = req.params;
    const requesterClerkId = req.auth.userId;

    // 🔒 ACL Check
    const user = await db.query.usersTable.findFirst({
        where: eq(usersTable.clerkId, requesterClerkId)
    });
    if (!user || user.id !== userId) return res.status(403).json({ error: "Forbidden" });

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
   💖 WISHLIST ROUTES (Secured)
========================================================= */

// GET /api/cart/wishlist/:userId
router.get("/wishlist/:userId", requireAuth, async (req, res) => {
    try {
      const { userId } = req.params;
      const requesterClerkId = req.auth.userId;

      // 🔒 ACL Check
      const user = await db.query.usersTable.findFirst({
          where: eq(usersTable.clerkId, requesterClerkId)
      });
      if (!user || user.id !== userId) return res.status(403).json({ error: "Forbidden" });
      
      const rawWishlistItems = await db.query.wishlistTable.findMany({
        where: eq(wishlistTable.userId, userId),
        with: {
          variant: {
            with: {
              product: {
                with: {
                  variants: true,
                  reviews: true 
                }
              }
            }
          }
        }
      });

      const wishlistItems = rawWishlistItems.map(item => {
        const product = item.variant.product;
        const variant = item.variant;

        const soldCount = product.variants 
          ? product.variants.reduce((sum, v) => sum + (v.sold || 0), 0) 
          : 0;
        
        let avgRating = 0;
        if (product.reviews && product.reviews.length > 0) {
            const total = product.reviews.reduce((sum, r) => sum + r.rating, 0);
            avgRating = (total / product.reviews.length).toFixed(1);
        }

        const { variants, reviews, ...cleanProduct } = product;

        return {
            wishlistId: item.id,
            userId: item.userId,
            variantId: item.variantId,
            variant: { ...variant, product: undefined }, 
            product: {
                ...cleanProduct,
                soldCount,
                avgRating 
            }
        };
      });

      res.json(wishlistItems);
    } catch (error) {
      console.error("❌ Error fetching wishlist:", error);
      res.status(500).json({ error: "Server error" });
    }
  }
);

// POST /api/cart/wishlist
router.post("/wishlist", requireAuth, async (req, res) => {
  try {
    const { productId, variantId } = req.body;
    const requesterClerkId = req.auth.userId;

    // 🔒 Security: Resolve User
    const user = await db.query.usersTable.findFirst({
        where: eq(usersTable.clerkId, requesterClerkId)
    });
    if (!user) return res.status(401).json({ error: "User not found" });
    const userId = user.id;

    if (!productId || !variantId) {
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
router.delete("/wishlist/:userId/:variantId", requireAuth, async (req, res) => {
  try {
    const { userId, variantId } = req.params;
    const requesterClerkId = req.auth.userId;

    // 🔒 ACL Check
    const user = await db.query.usersTable.findFirst({
        where: eq(usersTable.clerkId, requesterClerkId)
    });
    if (!user || user.id !== userId) return res.status(403).json({ error: "Forbidden" });

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
router.post("/wishlist/merge", requireAuth, async (req, res) => {
  const { guestWishlist } = req.body;
  const requesterClerkId = req.auth.userId;

  // 🔒 Security: Resolve User
  const user = await db.query.usersTable.findFirst({
      where: eq(usersTable.clerkId, requesterClerkId)
  });
  if (!user) return res.status(401).json({ error: "User not found" });
  const userId = user.id;

  if (!Array.isArray(guestWishlist) || guestWishlist.length === 0) {
    return res.status(400).json({ error: "Invalid request body" });
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
    res.status(500).json({ error: "Server error while merging wishlist." });
  }
});

// DELETE /api/cart/wishlist/:userId
router.delete("/wishlist/:userId", requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const requesterClerkId = req.auth.userId;

    // 🔒 ACL Check
    const user = await db.query.usersTable.findFirst({
        where: eq(usersTable.clerkId, requesterClerkId)
    });
    if (!user || user.id !== userId) return res.status(403).json({ error: "Forbidden" });

    await db.delete(wishlistTable).where(eq(wishlistTable.userId, userId));
    await invalidateMultiple([{ key: keys.makeWishlistKey(userId) }]);
    res.json({ success: true });
  } catch (error) {
    console.error("❌ Error clearing wishlist:", error);
    res.status(500).json({ error: "Server error" });
  }
});

/* =========================================================
   👑 ADMIN ROUTES (Secured)
========================================================= */

router.get("/admin/abandoned", requireAuth, verifyAdmin, async (req, res) => {
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

router.get("/admin/wishlist-stats", requireAuth, verifyAdmin, async (req, res) => {
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

router.post("/add-custom-bundle", requireAuth, async (req, res) => {
  const { templateVariantId, contentVariantIds } = req.body;
  const requesterClerkId = req.auth.userId;

  // 🔒 Security: Resolve User
  const user = await db.query.usersTable.findFirst({
      where: eq(usersTable.clerkId, requesterClerkId)
  });
  if (!user) return res.status(401).json({ error: "User not found" });
  const userId = user.id;

  if (!templateVariantId || !Array.isArray(contentVariantIds) || contentVariantIds.length !== 4) {
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