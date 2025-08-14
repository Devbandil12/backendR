// routes/cart.js
import express from "express";
import { db } from "../configs/index.js";
import { addToCartTable, productsTable } from "../configs/schema.js";
import { eq } from "drizzle-orm";

const router = express.Router();

// Get user's cart
router.get("/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const cartItems = await db
      .select({
        id: addToCartTable.id,
        productId: addToCartTable.productId,
        quantity: addToCartTable.quantity,
        productName: productsTable.name,
        oprice: productsTable.oprice,      // original price
        discount: productsTable.discount,  // discount %
        img: productsTable.imageurl,
        size: productsTable.size,
      })
      .from(addToCartTable)
      .innerJoin(productsTable, eq(addToCartTable.productId, productsTable.id))
      .where(eq(addToCartTable.userId, userId));

    res.json(cartItems);
  } catch (error) {
    console.error("❌ Error fetching cart:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Add to cart
router.post("/", async (req, res) => {
  try {
    const { userId, productId, quantity } = req.body;
    const [newItem] = await db
      .insert(addToCartTable)
      .values({ userId, productId, quantity })
      .returning();

    res.json(newItem);
  } catch (error) {
    console.error("❌ Error adding to cart:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Update quantity
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { quantity } = req.body;
    await db.update(addToCartTable).set({ quantity }).where(eq(addToCartTable.id, id));
    res.json({ success: true });
  } catch (error) {
    console.error("❌ Error updating cart:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Remove item
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await db.delete(addToCartTable).where(eq(addToCartTable.id, id));
    res.json({ success: true });
  } catch (error) {
    console.error("❌ Error removing cart item:", error);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
