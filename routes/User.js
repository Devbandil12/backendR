import express from "express";
import { db } from "../configs/index.js";
import { usersTable, ordersTable, orderItemsTable, productsTable } from "../configs/schema.js";
import { eq, asc } from "drizzle-orm";

const router = express.Router();

// ─── Get all users (admin) ───────────────────────────────
router.get("/", async (req, res) => {
  try {
    const users = await db.select().from(usersTable);
    res.json(users);
  } catch (err) {
    console.error("❌ Error fetching users:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ─── Get single user by ID ───────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, id));

    if (!user) return res.status(404).json({ error: "User not found" });

    res.json(user); // ✅ only user info, not orders
  } catch (err) {
    console.error("❌ Error fetching user:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ─── Get all orders for a specific user ──────────────────
router.get("/:id/orders", async (req, res) => {
  try {
    const { id } = req.params;

    const orders = await db.query.ordersTable.findMany({
      where: eq(ordersTable.userId, id),
      with: {
        orderItems: {
          with: { product: true },
        },
      },
      orderBy: [asc(ordersTable.createdAt)],
    });

    res.json(orders);
  } catch (err) {
    console.error("❌ Error fetching user orders:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
