import express from "express";
import { db } from "../configs/index.js";
import { usersTable, ordersTable, orderItemsTable, productsTable, UserAddressTable } from "../configs/schema.js";
import { eq } from "drizzle-orm";

const router = express.Router();

// New GET route to fetch all users for the admin panel with their addresses and orders
router.get("/", async (req, res) => {
  try {
    const allUsers = await db.query.usersTable.findMany({
      with: {
        orders: {
          with: {
            orderItems: true, // Also include the products for each order
          },
        },
        addresses: true,
      },
    });
    res.json(allUsers);
  } catch (error) {
    console.error("❌ [BACKEND] Error fetching all users with details:", error);
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
      .where(eq(usersTable.clerkId, clerkId));

    res.json(user[0] || null);
  } catch (error) {
    console.error("❌ [BACKEND] Error fetching user by clerkId:", error);
    res.status(500).json({ error: "Internal Server Error", details: error.message });
  }
});

// New PUT endpoint to update user details
router.put("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const [updatedUser] = await db
      .update(usersTable)
      .set(req.body)
      .where(eq(usersTable.id, id))
      .returning();

    if (!updatedUser) {
      return res.status(404).json({ message: "User not found" });
    }
    res.json(updatedUser);
  } catch (err) {
    console.error("Failed to update user:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// New DELETE endpoint to delete a user
router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await db.delete(usersTable).where(eq(usersTable.id, id));
    res.status(204).send();
  } catch (err) {
    console.error("Failed to delete user:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// The remaining routes from your original file are for fetching a user's specific orders, which is distinct from the admin panel's needs. We will keep them for the frontend logic.
router.get("/:id/addresses", async (req, res) => {
  try {
    const userId = req.params.id;

    const addresses = await db
      .select()
      .from(UserAddressTable)
      .where(eq(UserAddressTable.userId, userId));

    res.json(addresses);
  } catch (error) {
    console.error("❌ [BACKEND] Failed to get user addresses:", error);
    res.status(500).json({ error: "Internal Server Error", details: error.message });
  }
});

router.get("/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const orderQuery = await db
      .select({
        phone: ordersTable.phone,
        orderId: ordersTable.id,
        userId: ordersTable.userId,
        userName: usersTable.name,
        email: usersTable.email,
        paymentMode: ordersTable.paymentMode,
        totalAmount: ordersTable.totalAmount,
        paymentStatus: ordersTable.paymentStatus,
        transactionId: ordersTable.transactionId,
        status: ordersTable.status,
        progressStep: ordersTable.progressStep,
        createdAt: ordersTable.createdAt,
        address: ordersTable.address,
        city: ordersTable.city,
        state: ordersTable.state,
        zip: ordersTable.zip,
        country: ordersTable.country,
        refundId: ordersTable.refund_id,
        refundAmount: ordersTable.refund_amount,
        refundStatus: ordersTable.refund_status,
        refundSpeed: ordersTable.refund_speed,
        refundInitiatedAt: ordersTable.refund_initiated_at,
        refundCompletedAt: ordersTable.refund_completed_at,
      })
      .from(ordersTable)
      .innerJoin(usersTable, eq(ordersTable.userId, usersTable.id))
      .where(eq(ordersTable.userId, userId))
      .orderBy(asc(ordersTable.createdAt));

    if (!orderQuery.length) {
      return res.json([]);
    }

    const orderIds = orderQuery.map((o) => o.orderId);

    const productQuery = await db
      .select({
        orderId: orderItemsTable.orderId,
        productId: orderItemsTable.productId,
        quantity: orderItemsTable.quantity,
        oprice: productsTable.oprice,
        discount: productsTable.discount,
        productName: productsTable.name,
        img: productsTable.imageurl,
        size: productsTable.size,
      })
      .from(orderItemsTable)
      .innerJoin(productsTable, eq(orderItemsTable.productId, productsTable.id))
      .where(inArray(orderItemsTable.orderId, orderIds));

    const map = new Map();
    orderQuery.forEach((o) => {
      map.set(o.orderId, {
        ...o,
        refund: {
          id: o.refundId,
          amount: o.refundAmount,
          status: o.refundStatus,
          speedProcessed: o.refundSpeed,
          created_at: o.refundInitiatedAt
            ? new Date(o.refundInitiatedAt).getTime() / 1000
            : null,
          processed_at:
            o.refundCompletedAt
              ? Math.floor(new Date(o.refundCompletedAt).getTime() / 1000)
              : o.refundStatus === "processed"
              ? Math.floor(Date.now() / 1000)
              : null,
        },
        items: [],
      });
    });

    productQuery.forEach((p) => {
      const entry = map.get(p.orderId);
      if (entry) entry.items.push(p);
    });

    res.json(Array.from(map.values()));
  } catch (error) {
    console.error("❌ [BACKEND] Failed to get orders:", error);
    res.status(500).json({ error: "Internal Server Error", details: error.message });
  }
});

export default router;

