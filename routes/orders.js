import express from "express";
import { db } from "../configs/index.js";
import {
  orderItemsTable,
  ordersTable,
  productsTable,
  usersTable,
} from "../configs/schema.js";
import { eq, and, asc, sql } from "drizzle-orm";
import { cache, invalidateCache } from "../cacheMiddleware.js";

const router = express.Router();

// GET all orders for admin panel
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

// GET single order details
router.get("/:id", cache("order-details", 3600), async (req, res) => {
  try {
    const orderId = req.params.id;
    const order = await db.query.ordersTable.findFirst({
      where: eq(ordersTable.id, orderId),
      with: {
        user: { columns: { name: true, phone: true } },
        address: { // Restored the explicit columns for optimization
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
        orderItems: { with: { product: true } },
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
      user: undefined, address: undefined, orderItems: undefined,
    };

    res.json(formattedOrder);
  } catch (error) {
    console.error("❌ Error fetching order details:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// POST to get a user's orders
router.post("/get-my-orders", cache("user-orders", 300), async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: "User ID is required" });

    const myOrders = await db.query.ordersTable.findMany({
      where: eq(ordersTable.userId, userId),
      with: { orderItems: { with: { product: true } } },
      orderBy: [asc(ordersTable.createdAt)],
    });

    res.json(myOrders);
  } catch (error) {
    console.error("❌ Error fetching user's orders:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// PUT to update order status
router.put("/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!id || !status) return res.status(400).json({ error: "Order ID and status are required" });

    // --- LOGIC TO UPDATE 'SOLD' COUNT ---
    const [currentOrder] = await db.select().from(ordersTable).where(eq(ordersTable.id, id));
    
    if (currentOrder && currentOrder.status === 'order placed' && (status === 'Processing' || status === 'Shipped')) {
      const orderItems = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, id));

      for (const item of orderItems) {
        await db.update(productsTable)
          .set({ sold: sql`${productsTable.sold} + ${item.quantity}` })
          .where(eq(productsTable.id, item.productId));
      }
    }
    // --- END OF 'SOLD' COUNT LOGIC ---

    let newProgressStep = 1;
    if (status === "Processing") newProgressStep = 2;
    if (status === "Shipped") newProgressStep = 3;
    if (status === "Delivered") newProgressStep = 4;

    const [updatedOrder] = await db
      .update(ordersTable)
      .set({ status: status, progressStep: newProgressStep.toString() })
      .where(eq(ordersTable.id, id))
      .returning();

    if (!updatedOrder) return res.status(404).json({ error: "Order not found" });
    
    await invalidateCache("all-orders");
    await invalidateCache("order-details");
    await invalidateCache("user-orders");

    res.status(200).json({ message: "Order status updated successfully", updatedOrder });
  } catch (error) {
    console.error("❌ Error updating order status:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// PUT to cancel an order
router.put("/:id/cancel", async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: "Order ID is required" });

    const [canceledOrder] = await db
      .update(ordersTable)
      .set({ status: "Order Cancelled" })
      .where(and(eq(ordersTable.id, id), eq(ordersTable.status, "order placed")))
      .returning();

    if (!canceledOrder) return res.status(404).json({ error: "Order not found or cannot be canceled" });

    const orderItems = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, id));
    for (const item of orderItems) {
      await db
        .update(productsTable)
        .set({ stock: sql`${productsTable.stock} + ${item.quantity}` })
        .where(eq(productsTable.id, item.productId));
    }

    await invalidateCache("all-orders");
    await invalidateCache("order-details");
    await invalidateCache("user-orders");

    res.status(200).json({ message: "Order canceled successfully", canceledOrder });
  } catch (error) {
    console.error("❌ Error canceling order:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ADD THIS NEW ROUTE AT THE END OF THE FILE
router.get("/details/for-reports", async (req, res) => {
  try {
    const detailedOrders = await db.query.ordersTable.findMany({
      with: {
        orderItems: {
          with: {
            product: true, // This will include the full product details
          },
        },
      },
    });

    // We need to reshape the data slightly for the frontend
    const reportData = detailedOrders.map(order => ({
      ...order,
      products: order.orderItems.map(item => ({
        ...item.product, // Spread all product fields like costPrice, category
        price: item.price,
        quantity: item.quantity,
      })),
      orderItems: undefined, // Clean up the original structure
    }));

    res.json(reportData);
  } catch (error) {
    console.error("❌ Error fetching detailed orders for reports:", error);
    res.status(500).json({ error: "Server error" });
  }
});


export default router;