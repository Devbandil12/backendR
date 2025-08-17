import express from "express";
import { db } from "../configs/index.js";
import { productsTable } from "../configs/schema.js";

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
    res.status(500).json({
      error: "Failed to add product to the database."
    });
  }
});

export default router;
