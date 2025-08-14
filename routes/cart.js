// routes/cart.js
import express from "express";
import { db } from "../configs/index.js";
import { cartTable, productsTable } from "../configs/schema.js";
import { eq, inArray } from "drizzle-orm";

const router = express.Router();

// Get user's cart
router.get("/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const cartItems = await db
      .select({
        id: cartTable.id,
        productId: cartTable.productId,
        quantity: cartTable.quantity,
        productName: productsTable.name,
        price: productsTable.price,
        img: productsTable.imageurl,
        size: productsTable.size,
      })
      .from(cartTable)
      .innerJoin(productsTable, eq(cartTable.productId, productsTable.id))
      .where(eq(cartTable.userId, userId));

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
      .insert(cartTable)
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
    await db.update(cartTable).set({ quantity }).where(eq(cartTable.id, id));
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
    await db.delete(cartTable).where(eq(cartTable.id, id));
    res.json({ success: true });
  } catch (error) {
    console.error("❌ Error removing cart item:", error);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
