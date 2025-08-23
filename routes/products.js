// routes/products.js
import express from "express";
import { db } from "../configs/index.js";
import { productsTable } from "../configs/schema.js";
import { eq } from "drizzle-orm";
import { cache, invalidateCache } from "../cacheMiddleware.js";

const router = express.Router();

/**
 * 🟢 GET all products
 * Cache: 1 hour
 */
router.get("/", cache("all-products", 3600), async (req, res) => {
  try {
    const products = await db.select().from(productsTable);

    const transformedProducts = products.map((product) => {
      if (typeof product.imageurl === "string") {
        try {
          const parsedUrls = JSON.parse(product.imageurl);
          if (Array.isArray(parsedUrls)) {
            return { ...product, imageurl: parsedUrls };
          }
        } catch (err) {
          console.error("❌ Error parsing imageurl:", err);
        }
      }
      return product;
    });

    res.json(transformedProducts);
  } catch (error) {
    console.error("❌ Error fetching products:", error);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * 🟢 GET single product by ID
 * Cache: 30 min
 */
router.get("/:id", cache((req) => `product-${req.params.id}`, 1800), async (req, res) => {
  try {
    const { id } = req.params;
    const [product] = await db.select().from(productsTable).where(eq(productsTable.id, id));

    if (!product) return res.status(404).json({ error: "Product not found" });

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
});

/**
 * 🟢 POST new product
 * Clears cache if DB insert succeeds
 */
router.post("/", async (req, res) => {
  try {
    const productData = req.body;

    const [newProduct] = await db
      .insert(productsTable)
      .values({
        ...productData,
        imageurl: JSON.stringify(productData.imageurl),
      })
      .returning();

    // ✅ Invalidate cache AFTER DB success
    await invalidateCache("all-products");
    await invalidateCache(`product-${newProduct.id}`);

    res.status(201).json(newProduct);
  } catch (error) {
    console.error("❌ Error adding product:", error);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * 🟢 PUT update product
 * Clears cache if DB update succeeds
 */
router.put("/:id", async (req, res) => {
  const { id } = req.params;
  let updatedData = req.body;

  if (updatedData.imageurl && Array.isArray(updatedData.imageurl)) {
    updatedData.imageurl = JSON.stringify(updatedData.imageurl);
  }

  try {
    const [updatedProduct] = await db
      .update(productsTable)
      .set(updatedData)
      .where(eq(productsTable.id, id))
      .returning();

    if (!updatedProduct) {
      return res.status(404).json({ error: "Product not found." });
    }

    // ✅ Invalidate cache AFTER DB success
    await invalidateCache("all-products");
    await invalidateCache(`product-${id}`);

    res.json(updatedProduct);
  } catch (error) {
    console.error("❌ Error updating product:", error);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * 🟢 DELETE product
 * Clears cache if DB delete succeeds
 */
router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const [deletedProduct] = await db
      .delete(productsTable)
      .where(eq(productsTable.id, id))
      .returning();

    if (!deletedProduct) {
      return res.status(404).json({ error: "Product not found." });
    }

    // ✅ Invalidate cache AFTER DB success
    await invalidateCache("all-products");
    await invalidateCache(`product-${id}`);

    res.json({ success: true, deletedProduct });
  } catch (error) {
    console.error("❌ Error deleting product:", error);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
