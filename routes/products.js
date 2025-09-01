import express from "express";
import { db } from "../configs/index.js";
import { productsTable } from "../configs/schema.js";
import { eq } from "drizzle-orm";
import { cache, invalidateCache } from "../cacheMiddleware.js";

const router = express.Router();

/**
 * 🟢 GET all products
 * Cache for 1 hour
 */
router.get("/", cache("all-products", 3600), async (req, res) => {
  try {
    const products = await db.select().from(productsTable);

    const transformedProducts = products.map((product) => {
  // ✅ parse images
  let parsedUrls = product.imageurl;
  if (typeof product.imageurl === "string") {
    try {
      parsedUrls = JSON.parse(product.imageurl);
    } catch (err) {
      console.error("❌ Error parsing imageurl:", err);
    }
  }

  // ✅ calculate stock status
  let stockStatus = "In Stock";
  if (product.stock === 0) {
    stockStatus = "Out of Stock";
  } else if (product.stock <= 10) {
    stockStatus = `Only ${product.stock} left!`;
  }

  return { ...product, imageurl: parsedUrls, stockStatus };
});


    res.json(transformedProducts);
  } catch (error) {
    console.error("❌ Error fetching products:", error);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * 🟢 GET single product by ID
 * Cache for 30 min
 */
router.get(
  "/:id",
  cache((req) => `product-${req.params.id}`, 1800),
  async (req, res) => {
    try {
      const { id } = req.params;
      const [product] = await db
        .select()
        .from(productsTable)
        .where(eq(productsTable.id, id));

      if (!product) return res.status(404).json({ error: "Product not found" });

      if (typeof product.imageurl === "string") {
  try {
    product.imageurl = JSON.parse(product.imageurl);
  } catch {}
}

// ✅ add stock status
let stockStatus = "In Stock";
if (product.stock === 0) {
  stockStatus = "Out of Stock";
} else if (product.stock <= 10) {
  stockStatus = `Only ${product.stock} left!`;
}
product.stockStatus = stockStatus;


      res.json(product);
    } catch (error) {
      console.error("❌ Error fetching product:", error);
      res.status(500).json({ error: "Server error" });
    }
  }
);


/**
 * 🟢 GET all products grouped by name
 * This is a new endpoint for products with variations.
 */
router.get("/grouped", cache("grouped-products", 3600), async (req, res) => {
  try {
    const products = await db.select().from(productsTable);

    const groupedProducts = products.reduce((acc, product) => {
      // Parse image URLs
      let parsedUrls = product.imageurl;
      if (typeof product.imageurl === "string") {
        try {
          parsedUrls = JSON.parse(product.imageurl);
        } catch (err) {
          console.error("❌ Error parsing imageurl:", err);
        }
      }

      // Calculate stock status
      let stockStatus = "In Stock";
      if (product.stock === 0) {
        stockStatus = "Out of Stock";
      } else if (product.stock <= 10) {
        stockStatus = `Only ${product.stock} left!`;
      }

      const productWithStatus = { ...product, imageurl: parsedUrls, stockStatus };

      if (!acc[product.name]) {
        // First time seeing this product name
        acc[product.name] = {
          ...productWithStatus,
          variations: [productWithStatus],
        };
      } else {
        // Add variation to an existing product group
        acc[product.name].variations.push(productWithStatus);
        // Find the lowest price to display on the main product card
        if (product.oprice < acc[product.name].oprice) {
          acc[product.name].oprice = product.oprice;
          acc[product.name].id = product.id; // Update the ID to the one with the lowest price
          acc[product.name].discount = product.discount;
          acc[product.name].imageurl = parsedUrls;
          acc[product.name].stock = product.stock;
          acc[product.name].stockStatus = stockStatus;
        }
      }
      return acc;
    }, {});

    const result = Object.values(groupedProducts);

    res.json(result);
  } catch (error) {
    console.error("❌ Error fetching grouped products:", error);
    res.status(500).json({ error: "Server error" });
  }
});




/**
 * 🟢 POST add new product
 * Clears cache only AFTER DB success
 */
router.post("/", async (req, res) => {
  try {
    const productData = req.body;

    const [newProduct] = await db
      .insert(productsTable)
      .values({
        ...productData,
        imageurl: JSON.stringify(productData.imageurl),
        stock: productData.stock ?? 0,
      })
      .returning();

    // ✅ Invalidate caches
    await invalidateCache("all-products", true);
    await invalidateCache(`product-${newProduct.id}`);

    res.status(201).json(newProduct);
  } catch (error) {
    console.error("❌ Error adding product:", error);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * 🟢 PUT update product
 * Clears cache only AFTER DB success
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

    // ✅ Invalidate caches
    await invalidateCache("all-products", true);
    await invalidateCache(`product-${id}`);

    res.json(updatedProduct);
  } catch (error) {
    console.error("❌ Error updating product:", error);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * 🟢 DELETE product
 * Clears cache only AFTER DB success
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

    // ✅ Invalidate caches
    await invalidateCache("all-products", true);
    await invalidateCache(`product-${id}`);

    res.json({ success: true, deletedProduct });
  } catch (error) {
    console.error("❌ Error deleting product:", error);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
