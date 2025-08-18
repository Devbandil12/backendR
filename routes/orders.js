import express from "express";
import { db } from "../configs/index.js";
import {
  UserAddressTable,
  orderItemsTable,
  ordersTable,
  productsTable,
  usersTable,
} from "../configs/schema.js";
import { eq, inArray, and, asc } from "drizzle-orm";

const router = express.Router();

// New GET endpoint to fetch all orders for admin panel
router.get("/", async (req, res) => {
  try {
    const allOrders = await db
      .select({
        id: ordersTable.id,
        userId: ordersTable.userId,
        status: ordersTable.status,
        totalAmount: ordersTable.totalAmount,
        createdAt: ordersTable.createdAt,
        userEmail: usersTable.email,
      })
      .from(ordersTable)
      .innerJoin(usersTable, eq(ordersTable.userId, usersTable.id))
      .orderBy(asc(ordersTable.createdAt));
      
    res.json(allOrders);
  } catch (error) {
    console.error("❌ Error fetching all orders:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// GET order details by order ID
router.get("/:id", async (req, res) => {
  try {
    const orderId = Number(req.params.id);
    
    // Fetch order details
    const [order] = await db
      .select({
        id: ordersTable.id,
        userId: ordersTable.userId,
        status: ordersTable.status,
        totalAmount: ordersTable.totalAmount,
        createdAt: ordersTable.createdAt,
        paymentMode: ordersTable.paymentMode,
        paymentStatus: ordersTable.paymentStatus,
        transactionId: ordersTable.transactionId,
        address: ordersTable.address,
        city: ordersTable.city,
        state: ordersTable.state,
        zip: ordersTable.zip,
        country: ordersTable.country,
        userEmail: usersTable.email,
      })
      .from(ordersTable)
      .innerJoin(usersTable, eq(ordersTable.userId, usersTable.id))
      .where(eq(ordersTable.id, orderId));

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    // Fetch order items
    const products = await db
      .select({
        productId: orderItemsTable.productId,
        quantity: orderItemsTable.quantity,
        price: orderItemsTable.price,
        productName: productsTable.name,
        imageurl: productsTable.imageurl,
      })
      .from(orderItemsTable)
      .innerJoin(productsTable, eq(orderItemsTable.productId, productsTable.id))
      .where(eq(orderItemsTable.orderId, orderId));
      
    res.json({ ...order, products });
  } catch (error) {
    console.error("❌ Error fetching order details:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// New PUT endpoint to update an order's status
router.put("/:id/status", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  if (!status) {
    return res.status(400).json({ error: "Status is required." });
  }
  
  try {
    const [updatedOrder] = await db
      .update(ordersTable)
      .set({ status })
      .where(eq(ordersTable.id, Number(id)))
      .returning();

    if (!updatedOrder) {
      return res.status(404).json({ error: "Order not found." });
    }
    
    res.json(updatedOrder);
  } catch (error) {
    console.error("❌ Error updating order status:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// PUT /api/orders/:id/cancel — cancel an order
router.put("/:id/cancel", async (req, res) => {
  const { id } = req.params;
  try {
    const [canceledOrder] = await db
      .update(ordersTable)
      .set({ status: "Canceled" })
      .where(eq(ordersTable.id, Number(id)))
      .returning();

    if (!canceledOrder) {
      return res.status(404).json({ message: "Order not found." });
    }

    res.json(canceledOrder);
  } catch (err) {
    console.error("Failed to cancel order:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// The remaining routes are for fetching a user's specific orders, which is distinct from the admin panel's needs
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
