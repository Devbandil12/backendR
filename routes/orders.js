// routes/orders.js
import express from "express";
import { db } from "../configs/index.js";
import {
  addressTable,
  orderItemsTable,
  ordersTable,
  productsTable,
  usersTable,
} from "../configs/schema.js";
import { eq, inArray, and } from "drizzle-orm";

const router = express.Router();

router.get("/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    // Fetch orders
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
        street: addressTable.street,
        city: addressTable.city,
        state: addressTable.state,
        postalCode: addressTable.postalCode,
        country: addressTable.country,
        refundId: ordersTable.refund_id,
        refundAmount: ordersTable.refund_amount,
        refundStatus: ordersTable.refund_status,
        refundSpeed: ordersTable.refund_speed,
        refundInitiatedAt: ordersTable.refund_initiated_at,
        refundCompletedAt: ordersTable.refund_completed_at,
      })
      .from(ordersTable)
      .where(
        and(
          eq(ordersTable.userId, userId),
          inArray(ordersTable.paymentStatus, ["paid", "refunded", "pending"])
        )
      )
      .innerJoin(usersTable, eq(ordersTable.userId, usersTable.id))
      .leftJoin(addressTable, eq(addressTable.userId, ordersTable.userId));

    const orderIds = orderQuery.map((o) => o.orderId);
    if (!orderIds.length) return res.json([]);

    // Fetch items
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

    // Merge results
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
    console.error("❌ Error fetching orders:", error);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
