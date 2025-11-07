// routes/cart.js
import express from "express";
import { db } from "../configs/index.js";
import {
  addToCartTable,
  productsTable,
  productVariantsTable,
  wishlistTable,
  usersTable,
  productBundlesTable, // 🟢 FIX: Import productBundlesTable
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
      const cartItems = await db.query.addToCartTable.findMany({
          where: eq(addToCartTable.userId, userId),
          with: {
              variant: { with: { product: true } } // Get variant and its parent product
          }
      });

      // 🔽 --- START NEW LOGIC --- 🔽
      // Now, for each item, check if it's a bundle
      const detailedCartItems = await Promise.all(cartItems.map(async (item) => {
        // This query will now work because productBundlesTable is imported
        const bundleContents = await db.query.productBundlesTable.findMany({
          where: eq(productBundlesTable.bundleVariantId, item.variantId),
          with: {
            content: { // Get the full "content" variant
              with: {
                product: true // And also get its parent product
              }
            }
          }
        });

        if (bundleContents.length > 0) {
          return {
            ...item, // The main cart item (quantity, etc.)
            isBundle: true,
            // Format the contents to be clean for the frontend
            contents: bundleContents.map(c => ({
              quantity: c.quantity,
              name: c.content.product.name,
              variantName: c.content.name
            }))
          };
        }
        
        // Not a bundle, return as is
        return { ...item, isBundle: false };
      }));
      // 🔼 --- END NEW LOGIC --- 🔼

      // 🟢 MODIFIED: Return the new detailed list
      // This response is slightly different from your original,
      // it's now item.variant.product.name, not item.product.name
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

// 🟢 POST /api/cart — Add product to cart
router.post("/", async (req, res) => {
  try {
    // 🟢 MODIFIED: Receives variantId and productId
    const { userId, productId, variantId, quantity } = req.body;

    if (!userId || !productId || !variantId || !quantity) {
      return res.status(400).json({ error: "Missing required fields: userId, productId, variantId, quantity" });
    }

    // 🔴 This is incorrect based on your schema. productId is not in addToCartTable.
    // However, the frontend sends it, so we just need to insert what the DB expects.
    // The cart context logic *looks* like it sends productId, but the schema doesn't have it.
    // Let's check schema.js for addToCartTable...
    // export const addToCartTable = pgTable('add_to_cart', {
    //   id: uuid('id').defaultRandom().primaryKey(),
    //   userId: uuid('user_id').notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    //   variantId: uuid('variant_id').notNull().references(() => productVariantsTable.id, { onDelete: "cascade" }), 
    //   quantity: integer('quantity').notNull().default(1),
    //   addedAt: timestamp('added_at', { withTimezone: true }).defaultNow(),
    // });
    //
    // ✅ You are correct. The cart.js POST route has an error. It accepts `productId`
    // but the schema doesn't. And your `add-custom-bundle` route *also*
    // incorrectly tries to insert `productId`.
    // I will fix BOTH POST routes in this file.

    const [newItem] = await db
      .insert(addToCartTable)
      .values({ 
        userId, 
        variantId, // Only insert fields that are in the schema
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
            // productId: guestItem.productId, // 🔴 This field doesn't exist in the table
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
    // Let's check schema.js for wishlistTable...
    // export const wishlistTable = pgTable("wishlist_table", {
    //   id: uuid("id").defaultRandom().primaryKey(),
    //   userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    //   variantId: uuid("variant_id").notNull().references(() => productVariantsTable.id, { onDelete: "cascade" }),
    //   addedAt: timestamp("added_at", { withTimezone: true }).defaultNow(),
    // });
    //
    // ✅ Another bug found. The schema for wishlistTable does NOT have productId.
    // I will fix this insert as well.
    const [newItem] = await db
      .insert(wishlistTable)
      .values({ 
        userId, 
        // productId, // 🔴 This field doesn't exist in the table
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
  } catch (error)
    {
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
            // productId: item.productId, // 🔴 This field doesn't exist in the table
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

// Add this route inside routes/cart.js

router.post("/add-custom-bundle", async (req, res) => {
  // 1. Get the 4 selected variant IDs and the template product ID
  const { userId, templateVariantId, contentVariantIds } = req.body;

  if (!userId || !templateVariantId || !Array.isArray(contentVariantIds) || contentVariantIds.length !== 4) {
    return res.status(400).json({ error: "Invalid bundle data." });
  }

  try {
    const newCustomBundle = await db.transaction(async (tx) => {
      // 2. Get the template variant to copy its price, name, etc.
      const templateVariant = await tx.query.productVariantsTable.findFirst({
        where: eq(productVariantsTable.id, templateVariantId),
      });

      if (!templateVariant) throw new Error("Template variant not found.");

      // 3. Create a NEW, unique variant in the database
      // We make it "archived" so it doesn't show up in public listings
      const [newVariant] = await tx.insert(productVariantsTable).values({
        productId: templateVariant.productId,
        name: `Custom Combo - ${userId.slice(0, 8)}`, // Unique name
        size: templateVariant.size,
        oprice: templateVariant.oprice, // The pre-defined price!
        discount: templateVariant.discount,
        costPrice: templateVariant.costPrice,
        stock: 1, // Stock of 1, since this is a unique item
        isArchived: true, // Hide it from the public store
      }).returning();

      // 4. Link the 4 selected contents to this new variant
      const bundleEntries = contentVariantIds.map(contentId => ({
        bundleVariantId: newVariant.id,
        contentVariantId: contentId,
        quantity: 1,
      }));
      await tx.insert(productBundlesTable).values(bundleEntries);

      // 5. Add this new, unique variant to the user's cart
      const [cartItem] = await tx.insert(addToCartTable).values({
        userId: userId,
        variantId: newVariant.id,
        // productId: newVariant.productId, // 🔴 This field doesn't exist in the table
        quantity: 1,
      }).returning();

      return cartItem;
    });
    
    // 6. Invalidate the user's cart cache
    await invalidateMultiple([{ key: keys.makeCartKey(userId) }]);
    res.status(201).json(newCustomBundle);

  } catch (error) {
    console.error("❌ Error creating custom bundle:", error);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;