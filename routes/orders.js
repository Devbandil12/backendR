// ✅ file: routes/orders.js

import express from "express";
import Razorpay from "razorpay";
import { db } from "../configs/index.js";
import {
  orderItemsTable,
  ordersTable,
  productsTable,
  productVariantsTable,
  usersTable,
  activityLogsTable, 
  productBundlesTable 
} from "../configs/schema.js";
import { eq, asc, sql, inArray } from "drizzle-orm";
import { cache } from "../cacheMiddleware.js";
import { invalidateMultiple } from "../invalidateHelpers.js";
import {
  makeAllOrdersKey,
  makeOrderKey,
  makeUserOrdersKey,
  makeAllProductsKey,
  makeProductKey,
  makeAdminOrdersReportKey,
} from "../cacheKeys.js";
import { createNotification } from '../helpers/notificationManager.js';
import { generateInvoicePDF } from "../services/invoice.service.js";
import { processReferralCompletion } from "../controllers/referralController.js";

// 🔒 SECURITY: Import Middleware
import { requireAuth, verifyAdmin } from "../middleware/authMiddleware.js";

const router = express.Router();

// Initialize Razorpay for Auto-Sync
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_ID_KEY,
  key_secret: process.env.RAZORPAY_SECRET_KEY,
});

// Helper: Safely convert timestamp (seconds) to Date object
const safeDate = (timestamp) => {
  if (!timestamp || isNaN(timestamp)) return null;
  return new Date(timestamp * 1000);
};

/* ======================================================
   🔒 GET ALL ORDERS (Admin Only)
====================================================== */
router.get("/", requireAuth, verifyAdmin, cache(makeAllOrdersKey(), 600), async (req, res) => {
  try {
    const allOrders = await db
      .select({
        id: ordersTable.id,
        userId: ordersTable.userId,
        status: ordersTable.status,
        totalAmount: ordersTable.totalAmount,
        createdAt: ordersTable.createdAt,
        userEmail: usersTable.email,
        paymentMode: ordersTable.paymentMode,
        paymentStatus: ordersTable.paymentStatus,
        walletAmountUsed: ordersTable.walletAmountUsed,
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

/* ======================================================
   🔒 GET SINGLE ORDER (User & Admin)
   - Checks ownership
====================================================== */
router.get("/:id", requireAuth, async (req, res) => {
    try {
      const orderId = req.params.id;
      const requesterClerkId = req.auth.userId;

      // 1. Resolve Requester
      const requester = await db.query.usersTable.findFirst({
          where: eq(usersTable.clerkId, requesterClerkId),
          columns: { id: true, role: true }
      });
      if (!requester) return res.status(401).json({ error: "Unauthorized" });

      // 2. Fetch Order
      let order = await db.query.ordersTable.findFirst({
        where: eq(ordersTable.id, orderId),
        with: {
          user: { columns: { name: true, phone: true } },
          address: {
            columns: {
              address: true,
              landmark: true,
              city: true,
              state: true,
              postalCode: true,
              country: true,
              phone: true,
            },
          },
          orderItems: {
            with: {
              product: true,
              variant: true,
            },
          },
        },
      });

      if (!order) return res.status(404).json({ error: "Order not found" });

      // 🔒 3. OWNERSHIP CHECK
      if (order.userId !== requester.id && requester.role !== 'admin') {
          return res.status(403).json({ error: "Forbidden: You cannot view this order." });
      }

      // 🟢 4. AUTO-SYNC LOGIC (Keep existing logic)
      const isRefundActive = order.refund_id;
      const isMissingData =
        (order.refund_status !== 'processed' && order.refund_status !== 'failed') ||
        (order.refund_status === 'processed' && !order.refund_completed_at);

      if (isRefundActive && isMissingData) {
        try {
          console.log(`🔄 Syncing refund status for ${order.refund_id}...`);
          const refund = await razorpay.refunds.fetch(order.refund_id);

          if (refund.status !== order.refund_status || (refund.status === 'processed' && !order.refund_completed_at)) {
            let completedAt;
            if (refund.status === 'processed') {
              if (refund.processed_at) {
                completedAt = safeDate(refund.processed_at);
              } else {
                completedAt = new Date();
              }
            } else {
              completedAt = null;
            }

            await db.transaction(async (tx) => {
              await tx.update(ordersTable).set({
                refund_status: refund.status,
                refund_speed: refund.speed_processed || order.refund_speed,
                refund_completed_at: completedAt, 
                paymentStatus: refund.status === 'processed' ? 'refunded' : order.paymentStatus,
                updatedAt: new Date(),
              }).where(eq(ordersTable.id, orderId));

              await invalidateMultiple([
                { key: makeOrderKey(order.id) },
                { key: makeUserOrdersKey(order.userId) },
                { key: makeAllOrdersKey() },
              ]);
            });

            order.refund_status = refund.status;
            order.refund_speed = refund.speed_processed || order.refund_speed;
            order.refund_completed_at = completedAt;
            if (refund.status === 'processed') order.paymentStatus = 'refunded';
          }
        } catch (syncErr) {
          console.warn("⚠️ Failed to sync with Razorpay:", syncErr.message);
        }
      }

      // 5. Format Response
      const formattedOrder = {
        ...order,
        userName: order.user?.name,
        phone: order.user?.phone,
        shippingAddress: order.address,
        orderItems: order.orderItems?.map((item) => ({
          ...item.product,
          ...item.variant,
          productName: item.product.name,
          variantName: item.variant.name,
          quantity: item.quantity,
          price: item.price,
          img: item.product?.imageurl?.[0] || '',
          size: item.variant?.size || 'N/A',
        })),
        user: undefined,
        address: undefined,
      };

      res.json(formattedOrder);
    } catch (error) {
      console.error("❌ Error fetching order details:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  }
);

/* ======================================================
   🔒 GET INVOICE (User & Admin)
====================================================== */
router.get("/:id/invoice", requireAuth, async (req, res) => {
  try {
    const orderId = req.params.id;
    const requesterClerkId = req.auth.userId;

    // 1. Resolve Requester
    const requester = await db.query.usersTable.findFirst({
        where: eq(usersTable.clerkId, requesterClerkId),
        columns: { id: true, role: true }
    });
    if (!requester) return res.status(401).json({ error: "Unauthorized" });

    // 2. Fetch Order
    const order = await db.query.ordersTable.findFirst({
      where: eq(ordersTable.id, orderId),
      with: {
        user: { columns: { name: true, phone: true, email: true } },
        address: true,
        orderItems: {
          with: {
            product: true,
            variant: true,
          },
        },
      },
    });

    if (!order) return res.status(404).json({ error: "Order not found" });

    // 🔒 3. OWNERSHIP CHECK
    if (order.userId !== requester.id && requester.role !== 'admin') {
        return res.status(403).json({ error: "Forbidden" });
    }

    // 4. Generate Invoice (Existing Logic)
    const addr = order.address || {};
    const formattedAddress = [
      addr.address,
      addr.landmark,
      `${addr.city}, ${addr.state}`,
      `${addr.country} - ${addr.postalCode}`
    ].filter(Boolean).join(", ");

    const billing = {
      name: order.user?.name || "Guest",
      phone: order.address?.phone || order.user?.phone || "-",
      address: formattedAddress,
    };

    const items = order.orderItems.map(item => ({
      productName: item.product?.name || "Product",
      size: item.variant?.size || "-",
      quantity: item.quantity,
      price: item.price,
      totalPrice: item.price * item.quantity
    }));

    const subtotal = items.reduce((sum, item) => sum + item.totalPrice, 0);
    const totalDiscount = (order.discountAmount || 0) + (order.offerDiscount || 0);
    const walletUsed = order.walletAmountUsed || 0;
    const deliveryCharge = Math.max(0, order.totalAmount - subtotal + totalDiscount + walletUsed);

    let txnId = order.transactionId;
    if (!txnId || txnId === "null" || txnId === "undefined") {
      txnId = null;
    }

    const orderYear = new Date(order.createdAt).getFullYear();
    const invoiceNo = `INV-${orderYear}-${order.id}`;

    const orderData = {
      id: order.id,
      orderId: order.id,
      createdAt: order.createdAt,
      paymentMode: order.paymentMode,
      transactionId: txnId,
      invoiceNumber: invoiceNo,
      totals: {
        subtotal: subtotal,
        discount: totalDiscount,
        walletUsed: walletUsed,
        delivery: deliveryCharge,
        grandTotal: order.totalAmount
      }
    };

    const { filePath } = await generateInvoicePDF({
      order: orderData,
      items: items,
      billing: billing
    });

    res.download(filePath, `Invoice-${order.id}.pdf`);

  } catch (error) {
    console.error("❌ Error generating invoice:", error);
    res.status(500).json({ error: "Failed to generate invoice" });
  }
});

/* ======================================================
   🔒 POST GET MY ORDERS (User Only)
   - Ignores body.userId, uses Token
====================================================== */
router.post("/get-my-orders", requireAuth, async (req, res) => {
    try {
      // 🟢 SECURE: Use Token
      const requesterClerkId = req.auth.userId;
      
      const user = await db.query.usersTable.findFirst({
          where: eq(usersTable.clerkId, requesterClerkId),
          columns: { id: true }
      });

      if (!user) return res.status(404).json({ error: "User not found" });

      const userId = user.id;

      // Check Cache manually since we derived the key
      const cacheKey = makeUserOrdersKey(userId);
      // (Optional: Implement manual cache check here if needed, or rely on Drizzle)
      // For now, let's just run the query as your cache middleware wraps the route handler
      // But since we are modifying the req.body, the cache key generator in route might fail if it relies on body.userId
      // Note: The original route used `cache((req) => makeUserOrdersKey(req.body.userId))`
      // Since we are inside the handler, we can't use the middleware wrapper easily without refactoring.
      // Recommendation: For now, just fetch live data. Security > Stale Cache.

      const myOrders = await db.query.ordersTable.findMany({
        where: eq(ordersTable.userId, userId),
        with: {
          orderItems: {
            with: {
              product: true,
              variant: true,
            },
          },
        },
        orderBy: [asc(ordersTable.createdAt)],
      });

      const formattedOrders = myOrders.map(order => ({
        ...order,
        orderItems: order.orderItems.map(item => ({
          ...item,
          productName: item.product?.name || 'N/A',
          img: item.product?.imageurl?.[0] || '',
          size: item.variant?.size || 'N/A',
        }))
      }));

      res.json(formattedOrders);
    } catch (error) {
      console.error("❌ Error fetching user's orders:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  }
);

/* ======================================================
   🔒 PUT UPDATE STATUS (Admin Only)
====================================================== */
router.put("/:id/status", requireAuth, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, actorId: ignored } = req.body; 
    const requesterClerkId = req.auth.userId;

    if (!id || !status) return res.status(400).json({ error: "Order ID and status are required" });

    // 🟢 SECURE: Resolve Admin ID
    const adminUser = await db.query.usersTable.findFirst({
        where: eq(usersTable.clerkId, requesterClerkId),
        columns: { id: true }
    });
    const actorId = adminUser?.id;

    // Fetch current status
    const [currentOrder] = await db
      .select()
      .from(ordersTable)
      .where(eq(ordersTable.id, id));

    const oldStatus = currentOrder?.status;

    let newProgressStep = 1;
    if (status === "Processing") newProgressStep = 2;
    if (status === "Shipped") newProgressStep = 3;
    if (status === "Delivered") newProgressStep = 4;

    const [updatedOrder] = await db
      .update(ordersTable)
      .set({ status: status, progressStep: newProgressStep })
      .where(eq(ordersTable.id, id))
      .returning();

    if (!updatedOrder) return res.status(404).json({ error: "Order not found" });

    // 🟢 LOG ACTIVITY
    if (actorId && oldStatus !== status) {
      await db.insert(activityLogsTable).values({
        userId: actorId, 
        action: 'ORDER_STATUS_UPDATE',
        description: `Updated Order #${id} status: ${oldStatus} → ${status}`,
        performedBy: 'admin',
        metadata: { orderId: id, oldStatus, newStatus: status }
      });
    }

    // Referral Hook
    if (status.toLowerCase() === 'delivered') {
      try {
        await processReferralCompletion(updatedOrder.userId);
      } catch (refError) {
        console.error("⚠️ Referral completion failed:", refError);
      }
    }

    // Notification
    let message = `Your order #${updatedOrder.id} is now ${status}.`;
    if (status === 'Delivered') message = `Your order #${updatedOrder.id} has been delivered!`;
    else if (status === 'Shipped') message = `Your order #${updatedOrder.id} has shipped.`;

    await createNotification(
      updatedOrder.userId,
      message,
      `/myorder`,
      'order'
    );

    const itemsToInvalidate = [
       { key: makeAllOrdersKey() },
       { key: makeOrderKey(updatedOrder.id) },
       { key: makeUserOrdersKey(updatedOrder.userId) },
       { key: makeAdminOrdersReportKey() }
    ];

    await invalidateMultiple(itemsToInvalidate);

    res.status(200).json({ message: "Order status updated successfully", updatedOrder });
  } catch (error) {
    console.error("❌ Error updating order status:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

/* ======================================================
   🔒 PUT CANCEL ORDER (Admin Only)
====================================================== */
router.put("/:id/cancel", requireAuth, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const requesterClerkId = req.auth.userId;

    if (!id) return res.status(400).json({ error: "Order ID is required" });

    // 🟢 SECURE: Resolve Admin ID
    const adminUser = await db.query.usersTable.findFirst({
        where: eq(usersTable.clerkId, requesterClerkId),
        columns: { id: true }
    });
    const actorId = adminUser?.id;

    const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, id));
    if (!order) return res.status(404).json({ error: "Order not found" });

    if (order.status === "Order Cancelled") {
      return res.status(400).json({ error: "Order is already cancelled" });
    }

    // Online Refund Logic
    if (order.paymentMode === 'online' && order.transactionId && order.paymentStatus === 'paid') {
      try {
        const payment = await razorpay.payments.fetch(order.transactionId);
        const refundInit = await razorpay.payments.refund(order.transactionId, {
          amount: payment.amount,
          speed: 'optimum',
        });
        const refund = await razorpay.refunds.fetch(refundInit.id);

        await db.update(ordersTable).set({
          paymentStatus: 'refunded',
          refund_id: refund.id,
          refund_amount: refund.amount,
          refund_status: refund.status,
          updatedAt: new Date()
        }).where(eq(ordersTable.id, id));
      } catch (payErr) {
        console.error("Admin Auto-Refund Warning:", payErr.message);
      }
    }

    await db.update(ordersTable).set({
      status: "Order Cancelled",
      paymentStatus: order.paymentMode === 'cod' ? 'cancelled' : 'refunded', 
      updatedAt: new Date()
    }).where(eq(ordersTable.id, id));

    // Logging
    if (actorId) {
      await db.insert(activityLogsTable).values({
        userId: actorId,
        action: 'ORDER_CANCEL_ADMIN',
        description: `Admin cancelled Order #${id}`,
        performedBy: 'admin',
        metadata: { orderId: id, oldStatus: order.status }
      });
    }

    // Restore Stock
    const orderItems = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, id));
    const itemsToInvalidate = [
      { key: makeAllOrdersKey() },
      { key: makeOrderKey(id) },
      { key: makeUserOrdersKey(order.userId) },
      { key: makeAllProductsKey() }
    ];

    for (const item of orderItems) {
      await db.update(productVariantsTable).set({
        stock: sql`${productVariantsTable.stock} + ${item.quantity}`,
        sold: sql`${productVariantsTable.sold} - ${item.quantity}`
      }).where(eq(productVariantsTable.id, item.variantId));

      // Handle Bundles
      const bundleContents = await db.select().from(productBundlesTable)
        .where(eq(productBundlesTable.bundleVariantId, item.variantId));

      if (bundleContents.length > 0) {
        for (const content of bundleContents) {
          const qty = item.quantity * content.quantity;
          await db.update(productVariantsTable).set({
            stock: sql`${productVariantsTable.stock} + ${qty}`,
            sold: sql`${productVariantsTable.sold} - ${qty}`
          }).where(eq(productVariantsTable.id, content.contentVariantId));
        }
      }
      itemsToInvalidate.push({ key: makeProductKey(item.productId) });
    }

    await invalidateMultiple(itemsToInvalidate);
    await createNotification(order.userId, `Your order #${id} was cancelled by support.`, `/myorder`, 'order');

    res.json({ message: "Order cancelled by Admin" });

  } catch (error) {
    console.error("Admin Cancel Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

/* ======================================================
   🔒 GET REPORT DETAILS (Admin Only)
====================================================== */
router.get("/details/for-reports", requireAuth, verifyAdmin, cache(makeAdminOrdersReportKey(), 3600), async (req, res) => {
  try {
    const detailedOrders = await db.query.ordersTable.findMany({
      with: {
        orderItems: {
          with: {
            product: true,
            variant: true,
          },
        },
      },
    });

    const reportData = detailedOrders.map((order) => ({
      ...order,
      products: order.orderItems.map((item) => ({
        ...item.product,
        ...item.variant,
        price: item.price,
        quantity: item.quantity,
      })),
      orderItems: undefined,
    }));

    res.json(reportData);
  } catch (error) {
    console.error("❌ Error fetching detailed orders for reports:", error);
    res.status(500).json({ error: "Server error" });
  }
});

/* ======================================================
   🔒 BULK STATUS UPDATE (Admin Only)
====================================================== */
router.put("/bulk-status", requireAuth, verifyAdmin, async (req, res) => {
  try {
    const { orderIds, status, actorId: ignored } = req.body;
    const requesterClerkId = req.auth.userId;

    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({ error: "No order IDs provided" });
    }
    if (!status) return res.status(400).json({ error: "Status is required" });

    // 🟢 SECURE: Resolve Admin ID
    const adminUser = await db.query.usersTable.findFirst({
        where: eq(usersTable.clerkId, requesterClerkId),
        columns: { id: true }
    });
    const actorId = adminUser?.id;

    let newProgressStep = 1;
    if (status === "Processing") newProgressStep = 2;
    if (status === "Shipped") newProgressStep = 3;
    if (status === "Delivered") newProgressStep = 4;

    const updatedOrders = await db
      .update(ordersTable)
      .set({ 
        status: status, 
        progressStep: newProgressStep,
        updatedAt: new Date()
      })
      .where(inArray(ordersTable.id, orderIds))
      .returning();

    const itemsToInvalidate = [
      { key: makeAllOrdersKey() },
      { key: makeAdminOrdersReportKey() }
    ];

    await Promise.all(updatedOrders.map(async (order) => {
      // Log
      if (actorId) {
        await db.insert(activityLogsTable).values({
          userId: actorId,
          action: 'ORDER_STATUS_BULK_UPDATE',
          description: `Bulk updated Order #${order.id} to ${status}`,
          performedBy: 'admin',
          metadata: { orderId: order.id, newStatus: status }
        });
      }

      // Referral
      if (status.toLowerCase() === 'delivered') {
        try {
          await processReferralCompletion(order.userId);
        } catch (err) {
          console.error(`Referral error for ${order.id}:`, err);
        }
      }

      // Notification
      let message = `Your order #${order.id} is now ${status}.`;
      if (status === 'Delivered') message = `Your order #${order.id} has been delivered!`;
      else if (status === 'Shipped') message = `Your order #${order.id} has shipped.`;

      await createNotification(
        order.userId,
        message,
        `/myorder`,
        'order'
      );

      itemsToInvalidate.push({ key: makeOrderKey(order.id) });
      itemsToInvalidate.push({ key: makeUserOrdersKey(order.userId) });
    }));

    await invalidateMultiple(itemsToInvalidate);

    res.json({ 
      success: true, 
      message: `Successfully updated ${updatedOrders.length} orders to ${status}`,
      count: updatedOrders.length 
    });

  } catch (error) {
    console.error("❌ Bulk update error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;