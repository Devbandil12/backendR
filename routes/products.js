// routes/products.js
import express from "express";
import { db } from "../configs/index.js";
import { productsTable } from "../configs/schema.js";

const router = express.Router();

// Get all products
router.get("/", async (req, res) => {
  try {
    const products = await db.select().from(productsTable);
    res.json(products);
  } catch (error) {
    console.error("❌ Error fetching products:", error);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
