import express from "express";
import { db } from "../configs/index.js";
import { productsTable, productVariantsTable } from "../configs/schema.js";
import { eq, and } from "drizzle-orm";
import { cache, invalidateCache } from "../cacheMiddleware.js";

const router = express.Router();

/* ============================
   Helpers
   ============================ */
const getStockStatus = (stock) => {
  if (stock === 0) return "Out of Stock";
  if (stock <= 10) return `Only ${stock} left!`;
  return "In Stock";
};

const addVariantMeta = (variant) => {
  const finalPrice =
    variant.discount > 0
      ? Math.round(variant.oprice - (variant.oprice * variant.discount) / 100)
      : variant.oprice;

  return {
    ...variant,
    stockStatus: getStockStatus(variant.stock),
    finalPrice,
  };
};

/* ============================
   GET all products (catalog)
   ============================ */
router.get("/", cache("all-products", 3600), async (req, res) => {
  try {
    const products = await db.query.productsTable.findMany({
      with: { variants: true },
    });

    // Only include products with at least one visible variant
    const visibleProducts = products.filter((p) =>
      p.variants.some((v) => v.showAsSingleProduct)
    );

    const formatted = visibleProducts.map((p) => {
      const defaultVariant = p.variants.find((v) => v.showAsSingleProduct);
      return {
        ...p,
        defaultVariant: defaultVariant ? addVariantMeta(defaultVariant) : null,
      };
    });

    res.json(formatted);
  } catch (error) {
    console.error("❌ Error fetching products:", error);
    res.status(500).json({ error: "Server error" });
  }
});

/* ============================
   GET single product with all variants
   ============================ */
router.get(
  "/:id",
  cache((req) => `product-${req.params.id}`, 1800),
  async (req, res) => {
    try {
      const { id } = req.params;

      const product = await db.query.productsTable.findFirst({
        where: eq(productsTable.id, id),
        with: { variants: true },
      });

      if (!product) return res.status(404).json({ error: "Product not found" });

      const variantsWithMeta = product.variants.map(addVariantMeta);

      res.json({ ...product, variants: variantsWithMeta });
    } catch (error) {
      console.error("❌ Error fetching product:", error);
      res.status(500).json({ error: "Server error" });
    }
  }
);

/* ============================
   POST add new product + variants
   ============================ */
router.post("/", async (req, res) => {
  try {
    const { name, description, composition, fragrance, fragranceNotes, imageurl, variants } = req.body;

    const [newProduct] = await db
      .insert(productsTable)
      .values({
        name,
        description,
        composition,
        fragrance,
        fragranceNotes,
        imageurl, // JSONB column
      })
      .returning();

    let insertedVariants = [];
    if (variants?.length > 0) {
      for (const v of variants) {
        const [newVariant] = await db
          .insert(productVariantsTable)
          .values({
            productId: newProduct.id,
            size: v.size,
            oprice: v.oprice,
            discount: v.discount,
            stock: v.stock,
            showAsSingleProduct: v.showAsSingleProduct ?? false,
          })
          .returning();

        insertedVariants.push(addVariantMeta(newVariant));
      }
    }

    await invalidateCache("all-products", true);

    res.status(201).json({ ...newProduct, variants: insertedVariants });
  } catch (error) {
    console.error("❌ Error adding product:", error);
    res.status(500).json({ error: "Server error" });
  }
});

/* ============================
   PUT update product common fields
   ============================ */
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const updatedData = req.body;

    const [updatedProduct] = await db
      .update(productsTable)
      .set(updatedData)
      .where(eq(productsTable.id, id))
      .returning();

    if (!updatedProduct) {
      return res.status(404).json({ error: "Product not found." });
    }

    await invalidateCache("all-products", true);
    await invalidateCache(`product-${id}`);

    res.json(updatedProduct);
  } catch (error) {
    console.error("❌ Error updating product:", error);
    res.status(500).json({ error: "Server error" });
  }
});

/* ============================
   DELETE product (cascade deletes variants)
   ============================ */
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const [deletedProduct] = await db
      .delete(productsTable)
      .where(eq(productsTable.id, id))
      .returning();

    if (!deletedProduct) {
      return res.status(404).json({ error: "Product not found." });
    }

    await invalidateCache("all-products", true);
    await invalidateCache(`product-${id}`);

    res.json({ success: true, deletedProduct });
  } catch (error) {
    console.error("❌ Error deleting product:", error);
    res.status(500).json({ error: "Server error" });
  }
});

/* ============================
   VARIANT ROUTES
   ============================ */

/**
 * 🟢 POST add variant
 */
router.post("/:id/variants", async (req, res) => {
  try {
    const { id } = req.params;
    const { size, oprice, discount, stock, showAsSingleProduct } = req.body;

    const [newVariant] = await db
      .insert(productVariantsTable)
      .values({
        productId: id,
        size,
        oprice,
        discount,
        stock,
        showAsSingleProduct: showAsSingleProduct ?? false,
      })
      .returning();

    await invalidateCache("all-products", true);
    await invalidateCache(`product-${id}`);

    res.status(201).json(addVariantMeta(newVariant));
  } catch (error) {
    console.error("❌ Error adding variant:", error);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * 🟢 PUT update variant
 */
router.put("/:id/variants/:variantId", async (req, res) => {
  try {
    const { id, variantId } = req.params;
    const { size, oprice, discount, stock, showAsSingleProduct } = req.body;

    const [updatedVariant] = await db
      .update(productVariantsTable)
      .set({ size, oprice, discount, stock, showAsSingleProduct })
      .where(and(eq(productVariantsTable.id, variantId), eq(productVariantsTable.productId, id)))
      .returning();

    if (!updatedVariant) {
      return res.status(404).json({ error: "Variant not found." });
    }

    await invalidateCache("all-products", true);
    await invalidateCache(`product-${id}`);

    res.json(addVariantMeta(updatedVariant));
  } catch (error) {
    console.error("❌ Error updating variant:", error);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * 🟢 DELETE variant
 */
router.delete("/:id/variants/:variantId", async (req, res) => {
  try {
    const { id, variantId } = req.params;

    const [deletedVariant] = await db
      .delete(productVariantsTable)
      .where(and(eq(productVariantsTable.id, variantId), eq(productVariantsTable.productId, id)))
      .returning();

    if (!deletedVariant) {
      return res.status(404).json({ error: "Variant not found." });
    }

    await invalidateCache("all-products", true);
    await invalidateCache(`product-${id}`);

    res.json({ success: true, deletedVariant: addVariantMeta(deletedVariant) });
  } catch (error) {
    console.error("❌ Error deleting variant:", error);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
