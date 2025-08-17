// routes/products.js
import express from "express";
import { db } from "../configs/index.js";
import { productsTable } from "../configs/schema.js";
import { eq } from "drizzle-orm"; // New import

const router = express.Router();

// GET all products from the database
router.get("/", async (req, res) => {
  try {
    const products = await db.select().from(productsTable);

    // Ensure imageurl is an array before sending to the frontend
    const transformedProducts = products.map(product => {
      if (typeof product.imageurl === 'string') {
        try {
          const parsedUrls = JSON.parse(product.imageurl);
          if (Array.isArray(parsedUrls)) {
            return {
              ...product,
              imageurl: parsedUrls
            };
          }
        } catch (parseError) {
          console.error("❌ Error parsing imageurl from database:", parseError);
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

// POST a new product to the database
router.post("/", async (req, res) => {
  const productData = req.body;
  try {
    const [newProduct] = await db
      .insert(productsTable)
      .values({
        ...productData,
        imageurl: JSON.stringify(productData.imageurl),
      })
      .returning();
      
    res.status(201).json(newProduct);
  } catch (error) {
    console.error("❌ Error adding product:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// New PUT endpoint to update a product
router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const updatedData = req.body;
  
  // Ensure imageurl is handled correctly if provided
  if (updatedData.imageurl && Array.isArray(updatedData.imageurl)) {
    updatedData.imageurl = JSON.stringify(updatedData.imageurl);
  }

  try {
    const [updatedProduct] = await db
      .update(productsTable)
      .set(updatedData)
      .where(eq(productsTable.id, Number(id)))
      .returning();

    if (!updatedProduct) {
      return res.status(404).json({ error: "Product not found." });
    }

    res.json(updatedProduct);
  } catch (error) {
    console.error("❌ Error updating product:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// New DELETE endpoint to delete a product
router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const [deletedProduct] = await db
      .delete(productsTable)
      .where(eq(productsTable.id, Number(id)))
      .returning();

    if (!deletedProduct) {
      return res.status(404).json({ error: "Product not found." });
    }

    res.json({ message: "Product deleted successfully." });
  } catch (error) {
    console.error("❌ Error deleting product:", error);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
