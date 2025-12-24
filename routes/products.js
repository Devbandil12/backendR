// routes/products.js
import express from "express";
import { db } from "../configs/index.js";
import { productsTable, productVariantsTable, activityLogsTable, ordersTable, orderItemsTable, wishlistTable, } from "../configs/schema.js"; // 🟢 Added
import { eq, inArray, notInArray, desc, sql, and, gt, ne } from "drizzle-orm";
import { cache } from "../cacheMiddleware.js";
import { invalidateMultiple } from "../invalidateHelpers.js";
import { makeAllProductsKey, makeProductKey } from "../cacheKeys.js";

const router = express.Router();

// ... [GET Routes Unchanged] ...
router.get("/", cache(makeAllProductsKey(), 3600), async (req, res) => {
  try {
    const products = await db.query.productsTable.findMany({
      where: eq(productsTable.isArchived, false),
      with: { variants: { where: eq(productVariantsTable.isArchived, false) } },
    });
    res.json(products);
  } catch (error) {
    console.error("❌ Error fetching products:", error);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/archived", async (req, res) => {
  try {
    const archivedProducts = await db.query.productsTable.findMany({
      where: eq(productsTable.isArchived, true),
      with: { variants: true },
    });
    res.json(archivedProducts);
  } catch (error) {
    console.error("❌ Error fetching archived products:", error);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/:id", cache((req) => makeProductKey(req.params.id), 1800), async (req, res) => {
  try {
    const { id } = req.params;
    const product = await db.query.productsTable.findFirst({
      where: and(eq(productsTable.id, id), eq(productsTable.isArchived, false)),
      with: { variants: { where: eq(productVariantsTable.isArchived, false) }, reviews: true },
    });

    if (!product) return res.status(404).json({ error: "Product not found" });
    if (typeof product.imageurl === "string") { try { product.imageurl = JSON.parse(product.imageurl); } catch { } }
    res.json(product);
  } catch (error) {
    console.error("❌ Error fetching product:", error);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * 🟢 POST add new product (Modified for Logging)
 */
router.post("/", async (req, res) => {
  const { variants, actorId, ...productData } = req.body; // 🟢 Extract actorId

  if (!Array.isArray(variants) || variants.length === 0) {
    return res.status(400).json({ error: "Product must have at least one variant." });
  }

  try {
    const newProduct = await db.transaction(async (tx) => {
      const [product] = await tx.insert(productsTable).values({
        name: productData.name,
        description: productData.description,
        composition: productData.composition,
        fragrance: productData.fragrance,
        fragranceNotes: productData.fragranceNotes,
        category: productData.category,
        imageurl: productData.imageurl,
      }).returning();

      const variantsToInsert = variants.map((variant) => ({
        ...variant,
        productId: product.id,
      }));

      const insertedVariants = await tx.insert(productVariantsTable).values(variantsToInsert).returning();

      // 🟢 LOG ACTIVITY
      if (actorId) {
        await tx.insert(activityLogsTable).values({
          userId: actorId, // Admin ID (Actor)
          action: 'PRODUCT_CREATE',
          description: `Created product: ${product.name}`,
          performedBy: 'admin',
          metadata: { productId: product.id }
        });
      }

      return { ...product, variants: insertedVariants };
    });

    await invalidateMultiple([
      { key: makeAllProductsKey(), prefix: true },
      { key: makeProductKey(newProduct.id), prefix: true },
    ]);

    res.status(201).json(newProduct);
  } catch (error) {
    console.error("❌ Error adding product:", error);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * 🟢 PUT update product (Modified for Logging)
 */
router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const {
    variants, oprice, discount, size, stock,
    costPrice, sold, sku, isArchived, actorId, // 🟢 Extract actorId
    ...productData
  } = req.body;

  try {
    const currentProduct = await db.query.productsTable.findFirst({ where: eq(productsTable.id, id) });

    const [updatedProduct] = await db
      .update(productsTable)
      .set(productData)
      .where(eq(productsTable.id, id))
      .returning();

    if (!updatedProduct) return res.status(404).json({ error: "Product not found." });

    // 🟢 LOG CHANGES
    if (actorId && currentProduct) {
      const changes = [];
      if (productData.name && productData.name !== currentProduct.name) changes.push("Name");
      if (productData.category && productData.category !== currentProduct.category) changes.push("Category");
      // Add more field checks if needed

      if (changes.length > 0 || variants) {
        await db.insert(activityLogsTable).values({
          userId: actorId,
          action: 'PRODUCT_UPDATE',
          description: `Updated product ${updatedProduct.name}: ${changes.length > 0 ? changes.join(', ') : 'Variants updated'}`,
          performedBy: 'admin',
          metadata: { productId: id, changes }
        });
      }
    }

    await invalidateMultiple([
      { key: makeAllProductsKey(), prefix: true },
      { key: makeProductKey(id), prefix: true },
    ]);

    res.json(updatedProduct);
  } catch (error) {
    console.error("❌ Error updating product:", error);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * 🟢 PUT archive product (Modified for Logging)
 */
router.put("/:id/archive", async (req, res) => {
  const { id } = req.params;
  const { actorId } = req.body; // 🟢 Extract actorId

  try {
    const [archivedProduct] = await db
      .update(productsTable)
      .set({ isArchived: true })
      .where(eq(productsTable.id, id))
      .returning();

    if (!archivedProduct) return res.status(404).json({ error: "Product not found." });

    // 🟢 LOG ACTIVITY
    if (actorId) {
      await db.insert(activityLogsTable).values({
        userId: actorId,
        action: 'PRODUCT_ARCHIVE',
        description: `Archived product: ${archivedProduct.name}`,
        performedBy: 'admin',
        metadata: { productId: id }
      });
    }

    await invalidateMultiple([
      { key: makeAllProductsKey(), prefix: true },
      { key: makeProductKey(id), prefix: true },
    ]);

    res.json({ success: true, archivedProduct });
  } catch (error) {
    console.error("❌ Error archiving product:", error);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * 🟢 PUT unarchive product (Modified for Logging)
 */
router.put("/:id/unarchive", async (req, res) => {
  const { id } = req.params;
  const { actorId } = req.body; // 🟢 Extract actorId

  try {
    const [unarchivedProduct] = await db
      .update(productsTable)
      .set({ isArchived: false })
      .where(eq(productsTable.id, id))
      .returning();

    if (!unarchivedProduct) return res.status(404).json({ error: "Product not found." });

    // 🟢 LOG ACTIVITY
    if (actorId) {
      await db.insert(activityLogsTable).values({
        userId: actorId,
        action: 'PRODUCT_UNARCHIVE',
        description: `Unarchived product: ${unarchivedProduct.name}`,
        performedBy: 'admin',
        metadata: { productId: id }
      });
    }

    await invalidateMultiple([
      { key: makeAllProductsKey(), prefix: true },
      { key: makeProductKey(id), prefix: true },
    ]);

    res.json({ success: true, unarchivedProduct });
  } catch (error) {
    console.error("❌ Error unarchiving product:", error);
    res.status(500).json({ error: "Server error" });
  }
});


// 🟢 NEW: Manual Cache Invalidation Endpoint
router.post("/cache/invalidate", async (req, res) => {
  try {
    // Invalidate the main product list cache
    await invalidateMultiple([
      { key: makeAllProductsKey(), prefix: true }
    ]);
    res.json({ success: true, message: "Product cache invalidated." });
  } catch (error) {
    console.error("❌ Error invalidating cache:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// ... [Keep existing GET routes with cache enabled] ...
router.get("/", cache(makeAllProductsKey(), 3600), async (req, res) => {
  // ... existing code ...
  try {
    const products = await db.query.productsTable.findMany({
      where: eq(productsTable.isArchived, false),
      with: { variants: { where: eq(productVariantsTable.isArchived, false) } },
    });
    res.json(products);
  } catch (error) {
    console.error("❌ Error fetching products:", error);
    res.status(500).json({ error: "Server error" });
  }
});


router.post('/recommendations', async (req, res) => {
  const { excludeIds, userId } = req.body;

  try {
    // 1. SANITIZE INPUTS
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const safeExcludeIds = (excludeIds || []).filter(id => typeof id === 'string' && uuidRegex.test(id));
    const safeUserId = (typeof userId === 'string' && uuidRegex.test(userId)) ? userId : null;

    // 2. AGGREGATE USER HISTORY
    let sourceProductIds = new Set(safeExcludeIds);

    if (safeUserId) {
      // Recent Orders
      const recentOrders = await db.select({ productId: orderItemsTable.productId })
        .from(orderItemsTable)
        .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
        .where(eq(ordersTable.userId, safeUserId))
        .orderBy(desc(ordersTable.createdAt))
        .limit(10);

      recentOrders.forEach(o => sourceProductIds.add(o.productId));

      // Wishlist
      const wishlist = await db.select({ productId: productVariantsTable.productId })
        .from(wishlistTable)
        .innerJoin(productVariantsTable, eq(wishlistTable.variantId, productVariantsTable.id))
        .where(eq(wishlistTable.userId, safeUserId));

      wishlist.forEach(w => sourceProductIds.add(w.productId));
    }

    // 3. FETCH CANDIDATES
    // Filter: Active products AND NOT 'Template' category
    let whereClause = and(
        eq(productsTable.isArchived, false),
        ne(productsTable.category, 'Template') 
    );

    if (safeExcludeIds.length > 0) {
      whereClause = and(
        eq(productsTable.isArchived, false),
        ne(productsTable.category, 'Template'),
        notInArray(productsTable.id, safeExcludeIds)
      );
    }

    let candidates = await db.query.productsTable.findMany({
      where: whereClause,
      with: {
        variants: {
          // 🟢 EXPLICITLY SELECT COLUMNS (Added 'name' here)
          columns: {
            id: true,
            name: true,     // <--- ADDED: Fixes the "undefined" toast issue
            size: true,
            oprice: true,
            discount: true,
            stock: true,
            isArchived: true
          },
          where: and(
            eq(productVariantsTable.isArchived, false),
            gt(productVariantsTable.stock, 0)
          )
        }
      }
    });

    if (candidates.length === 0) return res.json([]);

    // 4. SCORE & RETURN
    const uniqueSourceIds = Array.from(sourceProductIds);
    const safeSourceIds = uniqueSourceIds.filter(id => uuidRegex.test(id));

    if (safeSourceIds.length === 0) {
      return res.json([]);
    }

    // Fetch source products for matching
    let sourceProducts = [];
    if (safeSourceIds.length > 0) {
      sourceProducts = await db.query.productsTable.findMany({
        where: inArray(productsTable.id, safeSourceIds),
      });
    }

    const profile = { compositions: new Set(), fragrances: new Set(), notes: new Set() };

    sourceProducts.forEach(p => {
      if (p.composition) profile.compositions.add(p.composition.toLowerCase().trim());
      if (p.fragrance) profile.fragrances.add(p.fragrance.toLowerCase().trim());
      if (p.fragranceNotes) p.fragranceNotes.split(',').forEach(n => profile.notes.add(n.toLowerCase().trim()));
    });

    const scoredCandidates = candidates.map(product => {
      let score = 0;
      let reasons = [];

      if (product.composition && profile.compositions.has(product.composition.toLowerCase().trim())) score += 2;
      if (product.fragrance && profile.fragrances.has(product.fragrance.toLowerCase().trim())) {
        score += 3;
        reasons.push(product.fragrance);
      }

      const matchReason = reasons.length > 0 ? reasons.join(" • ") : "Trending";
      return { ...product, score, matchReason };
    })
    // Filter: Only keep items that match
    .filter(product => product.score > 0);

    // Sort by score
    scoredCandidates.sort((a, b) => b.score - a.score);

    res.json(scoredCandidates.slice(0, 4));

  } catch (error) {
    console.error("Recommend Error:", error);
    res.json([]);
  }
});

export default router;