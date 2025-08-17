import express from "express";
import { db } from "../configs/index.js";
import { productsTable } from "../configs/schema.js";

const router = express.Router();

// Get all products from the database and return as a JSON response
router.get("/", async (req, res) => {
  try {
    const products = await db.select().from(productsTable);

    // CRITICAL FIX: Transform the imageurl field from a JSON string to an array
    const transformedProducts = products.map(product => {
      // Check if imageurl is a string (which it will be if it was stringified on insert)
      if (typeof product.imageurl === 'string') {
        try {
          // Parse the JSON string back into a JavaScript array
          const parsedImageUrl = JSON.parse(product.imageurl);
          // If the parsing is successful and the result is an array, use it
          if (Array.isArray(parsedImageUrl)) {
            return {
              ...product,
              imageurl: parsedImageUrl
            };
          }
        } catch (parseError) {
          // In case of a parsing error, log it and return the product as is
          console.error("❌ Error parsing imageurl:", parseError);
        }
      }
      // If imageurl is already an array or parsing failed, return the product as is
      return product;
    });

    res.json(transformedProducts);
  } catch (error) {
    console.error("❌ Error fetching products:", error);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
