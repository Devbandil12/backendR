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
// 🟢 Import your cache and invalidateCache middleware
import { cache, invalidateCache } from "../cacheMiddleware.js";

const router = express.Router();

// New GET endpoint to fetch all orders for admin panel
// 🟢 Cache this GET route with a generous TTL
router.get("/", cache("all-orders", 600), async (req, res) => {
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

router.get("/:id", cache("order-details", 3600), async (req, res) => {
  try {
    const orderId = req.params.id;

    const order = await db.query.ordersTable.findFirst({
      where: eq(ordersTable.id, orderId),
      with: {
        user: {
          columns: {
            name: true,
            phone: true
          }
        },
        address: {
          columns: {
            address: true,
            landmark: true, 
            city: true,
            state: true,
            postalCode: true,
            country: true,
            phone: true,
          }
        },
        orderItems: {
          with: {
            product: true,
          },
        },
      },
    });

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    const formattedOrder = {
      ...order,
      userName: order.user?.name,
      phone: order.user?.phone,
      shippingAddress: order.address,
      products: order.orderItems?.map(item => ({
        ...item.product,
        productName: item.product.name, 
        quantity: item.quantity,
        price: item.price,
      })),
      user: undefined,
      address: undefined,
      orderItems: undefined,
    };

    res.json(formattedOrder);
  } catch (error) {
    console.error("❌ Error fetching order details:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// 🟢 Cache this POST route as it's a read operation
router.post("/get-my-orders", cache("user-orders", 300), async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    const myOrders = await db.query.ordersTable.findMany({
      where: eq(ordersTable.userId, userId),
      with: {
        orderItems: {
          with: {
            product: true,
          },
        },
      },
      orderBy: [asc(ordersTable.createdAt)],
    });

    res.json(myOrders);
  } catch (error) {
    console.error("❌ Error fetching user's orders:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.put("/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!id || !status) {
      return res.status(400).json({ error: "Order ID and status are required" });
    }
    const [updatedOrder] = await db
      .update(ordersTable)
      .set({ status })
      .where(eq(ordersTable.id, id))
      .returning();

    if (!updatedOrder) {
      return res.status(404).json({ error: "Order not found" });
    }
    // 🟢 Invalidate the cache for all orders and the specific order
    await invalidateCache("all-orders");
    await invalidateCache("order-details");
    await invalidateCache("user-orders");

    res.status(200).json({ message: "Order status updated successfully", updatedOrder });
  } catch (error) {
    console.error("❌ Error updating order status:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.put("/:id/cancel", async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: "Order ID is required" });
    }
    
    const [canceledOrder] = await db
      .update(ordersTable)
      .set({ status: "Canceled" })
      .where(and(eq(ordersTable.id, id), eq(ordersTable.status, "Pending")))
      .returning();

    if (!canceledOrder) {
      return res.status(404).json({ error: "Order not found or cannot be canceled" });
    }
    // 🟢 Invalidate the cache for all orders and the specific order
    await invalidateCache("all-orders");
    await invalidateCache("order-details");
    await invalidateCache("user-orders");

    res.status(200).json({ message: "Order canceled successfully", canceledOrder });
  } catch (error) {
    console.error("❌ Error canceling order:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;