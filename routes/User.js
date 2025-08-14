// routes/user.js
import express from "express";
import { db } from "../configs/index.js";
import {
  usersTable,
  ordersTable,
  orderItemsTable,
  productsTable,
  UserAddressTable,
} from "../configs/schema.js";
import { eq } from "drizzle-orm";

const router = express.Router();

/**
 * GET user by email
 * Example: GET /api/users?email=test@example.com
 */
router.get("/", async (req, res) => {
  try {
    const email = req.query.email;
    if (!email) return res.status(400).json({ error: "Email required" });

    const user = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email));

    res.json(user[0] || null);
  } catch (error) {
    console.error("❌ Error fetching user:", error);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST create new user
 */
router.post("/", async (req, res) => {
  try {
    const { name, email } = req.body;
    if (!name || !email) {
      return res.status(400).json({ error: "Name and email required" });
    }

    const [newUser] = await db
      .insert(usersTable)
      .values({ name, email, role: "user", cartLength: 0 })
      .returning();

    res.json(newUser);
  } catch (error) {
    console.error("❌ Error creating user:", error);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * GET orders for a user
 */
router.get("/:id/orders", async (req, res) => {
  try {
    const userId = req.params.id;

    const result = await db
      .select({
        orderId: ordersTable.id,
        totalAmount: ordersTable.totalAmount,
        status: ordersTable.status,
        paymentMode: ordersTable.paymentMode,
        paymentStatus: ordersTable.paymentStatus,
        createdAt: ordersTable.createdAt,
        productId: orderItemsTable.productId,
        quantity: orderItemsTable.quantity,
        price: orderItemsTable.price,
        productName: productsTable.name,
        productImage: productsTable.imageurl,
      })
      .from(ordersTable)
      .innerJoin(orderItemsTable, eq(ordersTable.id, orderItemsTable.orderId))
      .innerJoin(productsTable, eq(orderItemsTable.productId, productsTable.id))
      .where(eq(ordersTable.userId, userId))
      .orderBy(ordersTable.createdAt);

    // Group by orderId
    const groupedOrders = result.reduce((acc, item) => {
      if (!acc[item.orderId]) {
        acc[item.orderId] = {
          orderId: item.orderId,
          totalAmount: item.totalAmount,
          status: item.status,
          createdAt: item.createdAt,
          paymentStatus: item.paymentStatus,
          paymentMode: item.paymentMode,
          items: [],
        };
      }
      acc[item.orderId].items.push({
        productId: item.productId,
        productName: item.productName,
        productImage: item.productImage,
        quantity: item.quantity,
        price: item.price,
      });
      return acc;
    }, {});

    res.json(Object.values(groupedOrders));
  } catch (error) {
    console.error("❌ Failed to get orders:", error);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * GET addresses for a user
 */
router.get("/:id/addresses", async (req, res) => {
  try {
    const userId = req.params.id;

    const addresses = await db
      .select()
      .from(UserAddressTable)
      .where(eq(UserAddressTable.userId, userId));

    res.json(addresses);
  } catch (error) {
    console.error("❌ Failed to get addresses:", error);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
