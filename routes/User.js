import express from "express";
import { db } from "../configs/index.js";
import { usersTable, ordersTable, orderItemsTable, productsTable, UserAddressTable } from "../configs/schema.js";
import { eq } from "drizzle-orm";

const router = express.Router();

// New GET route to fetch all users for the admin panel
router.get("/", async (req, res) => {
  try {
    const allUsers = await db.select().from(usersTable);
    res.json(allUsers);
  } catch (error) {
    console.error("❌ [BACKEND] Error fetching all users:", error);
    res.status(500).json({ error: "Internal Server Error", details: error.message });
  }
});


// Existing route to find user by clerkId
router.get("/find-by-clerk-id", async (req, res) => {
  try {
    const clerkId = req.query.clerkId;
    if (!clerkId) {
      return res.status(400).json({ error: "clerkId required for user lookup." });
    }

    const user = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkId, clerkId)); // Use clerkId column name

    res.json(user[0] || null);
  } catch (error) {
    console.error("❌ [BACKEND] Error fetching user by clerkId:", error);
    res.status(500).json({ error: "Internal Server Error", details: error.message });
  }
});

// The following routes remain unchanged
router.post("/", async (req, res) => {
  try {
    if (Object.keys(req.body).length === 0) {
      return res.status(400).json({
        error: "Request body is empty.",
        hint: "Check your frontend fetch call. Is the `Content-Type: application/json` header set? Is the body being sent?"
      });
    }

    const { name, email, clerkId } = req.body; // Destructure clerkId

    if (!name || !email || !clerkId) {
      return res.status(400).json({
        error: "Missing required fields.",
        details: "The request body must contain 'name', 'email', and 'clerkId'.",
        receivedBody: req.body
      });
    }

    const [newUser] = await db
      .insert(usersTable)
      .values({ name, email, clerkId, role: "user", cartLength: 0 }) // Use clerkId column name
      .returning();

    if (!newUser) {
      return res.status(500).json({
        error: "Failed to insert new user into database.",
        details: "Drizzle returned an empty result. Check database connection and schema."
      });
    }

    res.status(201).json(newUser);

  } catch (error) {
    console.error("❌ [BACKEND] Error creating new user:", error);
    if (error.message.includes("duplicate key")) {
        return res.status(409).json({
            error: "User already exists.",
            details: "A user with this email address already exists in the database. A unique constraint was violated.",
            receivedEmail: req.body.email
        });
    }
    res.status(500).json({
        error: "Internal Server Error",
        details: error.message
    });
  }
});

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
    console.error("❌ [BACKEND] Failed to get orders:", error);
    res.status(500).json({ error: "Internal Server Error", details: error.message });
  }
});

router.get("/:id/addresses", async (req, res) => {
  try {
    const userId = req.params.id;

    const addresses = await db
      .select()
      .from(UserAddressTable)
      .where(eq(UserAddressTable.userId, userId));

    res.json(addresses);
  } catch (error) {
    console.error("❌ [BACKEND] Failed to get addresses:", error);
    res.status(500).json({ error: "Internal Server Error", details: error.message });
  }
});

export default router;
