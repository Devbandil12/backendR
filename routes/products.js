// routes/products.js
import express from "express";
import { db } from "../configs/index.js";
import { productsTable, productVariantsTable } from "../configs/schema.js";
import { eq, and } from "drizzle-orm"; // Import 'and'
import { cache } from "../cacheMiddleware.js";
import { invalidateMultiple } from "../invalidateHelpers.js";
import { makeAllProductsKey, makeProductKey } from "../cacheKeys.js";

const router = express.Router();

/**
 * GET all products (for customers)
 * Filters out all archived products and variants
 */
router.get("/", cache(makeAllProductsKey(), 3600), async (req, res) => {
  try {
    const products = await db.query.productsTable.findMany({
      where: eq(productsTable.isArchived, false),
      with: {
        variants: {
          where: eq(productVariantsTable.isArchived, false),
        },
      },
    });
    res.json(products);
  } catch (error) {
    console.error("❌ Error fetching products:", error);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * 🟢 NEW: GET all archived products (for admin)
 * This route must come *before* the '/:id' route.
 */
router.get("/archived", async (req, res) => {
  // ⛔️ You should add admin-auth middleware here
  try {
    const archivedProducts = await db.query.productsTable.findMany({
      where: eq(productsTable.isArchived, true),
      with: {
        variants: true, // Show all variants, even archived ones
      },
    });
    res.json(archivedProducts);
  } catch (error) {
    console.error("❌ Error fetching archived products:", error);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * GET single product by ID (for customers)
 * MODIFIED: Will not find archived products or variants
 */
router.get(
  "/:id",
  cache((req) => makeProductKey(req.params.id), 1800),
  async (req, res) => {
    try {
      const { id } = req.params;
      const product = await db.query.productsTable.findFirst({
        where: and(
          eq(productsTable.id, id),
          eq(productsTable.isArchived, false)
        ),
        with: {
          variants: {
            where: eq(productVariantsTable.isArchived, false),
          },
          reviews: true,
        },
      });

      if (!product) {
        return res.status(404).json({ error: "Product not found" });
      }

      if (typeof product.imageurl === "string") {
        try {
          product.imageurl = JSON.parse(product.imageurl);
        } catch {}
      }
      res.json(product);
    } catch (error) {
      console.error("❌ Error fetching product:", error);
      res.status(500).json({ error: "Server error" });
    }
  }
);

/**
 * POST add new product (with variants)
 * (Unchanged)
 */
router.post("/", async (req, res) => {
  const { variants, ...productData } = req.body;

  if (!Array.isArray(variants) || variants.length === 0) {
    return res
      .status(400)
      .json({ error: "Product must have at least one variant." });
  }

  try {
    const newProduct = await db.transaction(async (tx) => {
      const [product] = await tx
        .insert(productsTable)
        .values({
          name: productData.name,
          description: productData.description,
          composition: productData.composition,
          fragrance: productData.fragrance,
          fragranceNotes: productData.fragranceNotes,
          category: productData.category,
          imageurl: productData.imageurl,
          // 'isArchived' will use the database default (false)
        })
        .returning();

      const variantsToInsert = variants.map((variant) => ({
        ...variant,
        productId: product.id,
        // 'isArchived' will use the database default (false)
      }));

      const insertedVariants = await tx
        .insert(productVariantsTable)
        .values(variantsToInsert)
        .returning();

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
 * PUT update product (Main Info Only)
 * (Unchanged)
 */
router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const {
    variants, oprice, discount, size, stock,
    costPrice, sold, sku, isArchived, 
    ...productData 
  } = req.body;

  try {
    const [updatedProduct] = await db
      .update(productsTable)
      .set(productData) 
      .where(eq(productsTable.id, id))
      .returning();

    if (!updatedProduct) {
      return res.status(404).json({ error: "Product not found." });
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
 * 🟢 NEW: PUT to archive a product
 */
router.put("/:id/archive", async (req, res) => {
  const { id } = req.params;
  try {
    const [archivedProduct] = await db
      .update(productsTable)
      .set({ isArchived: true }) 
      .where(eq(productsTable.id, id))
      .returning();

    if (!archivedProduct) {
      return res.status(404).json({ error: "Product not found." });
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
 * 🟢 NEW: PUT to unarchive a product
 */
router.put("/:id/unarchive", async (req, res) => {
  const { id } = req.params;
  try {
    const [unarchivedProduct] = await db
      .update(productsTable)
      .set({ isArchived: false }) 
      .where(eq(productsTable.id, id))
      .returning();

    if (!unarchivedProduct) {
      return res.status(404).json({ error: "Product not found." });
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

export default router;