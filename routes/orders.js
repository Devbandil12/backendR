// file routes/orders.js

import express from "express";
import Razorpay from "razorpay"; // 🟢 IMPORT RAZORPAY
import { db } from "../configs/index.js";
import {
    orderItemsTable,
    ordersTable,
    productsTable,
    productVariantsTable, // 🟢 ADDED
    usersTable,
    // productBundlesTable, // 🔴 REMOVED (was only for cancel)
} from "../configs/schema.js";
import { eq, asc, sql } from "drizzle-orm"; // 🔴 REMOVED 'and'
// 🟢 Import new cache helpers
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

const router = express.Router();

// 🟢 Initialize Razorpay for Auto-Sync
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_ID_KEY,
    key_secret: process.env.RAZORPAY_SECRET_KEY,
});

// Helper: Safely convert timestamp to Date object
const safeDate = (timestamp) => {
    if (!timestamp || isNaN(timestamp)) return null;
    return new Date(timestamp * 1000);
};

// 🟢 GET all orders for admin panel
router.get("/", cache(makeAllOrdersKey(), 600), async (req, res) => {
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

// 🟢 GET single order details (WITH AUTO-SYNC)
router.get(
    "/:id",
    // 🟢 REMOVED CACHE to ensure "Refresh Status" works and frontend doesn't show stale data
    async (req, res) => {
        try {
            const orderId = req.params.id;
            
            // 1. Fetch Order
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
                            product: true, // Gets the parent product (name, images)
                            variant: true, // Gets the specific variant (size, price)
                        },
                    },
                },
            });

            if (!order) {
                return res.status(404).json({ error: "Order not found" });
            }

            // 🟢 2. AUTO-SYNC LOGIC: Check Razorpay if refund is 'in_progress'
            if (order.refund_id && order.refund_status === 'in_progress') {
                try {
                    console.log(`🔄 Syncing refund status for ${order.refund_id}...`);
                    const refund = await razorpay.refunds.fetch(order.refund_id);

                    // If status has changed in Razorpay but not in DB, update DB
                    if (refund.status !== order.refund_status) {
                        const completedAt = (refund.status === 'processed' && refund.processed_at)
                            ? safeDate(refund.processed_at)
                            : null;

                        await db.update(ordersTable).set({
                            refund_status: refund.status,
                            refund_speed: refund.speed_processed || order.refund_speed,
                            refund_completed_at: completedAt,
                            // Mark as refunded if processed
                            paymentStatus: refund.status === 'processed' ? 'refunded' : order.paymentStatus,
                            updatedAt: new Date(),
                        }).where(eq(ordersTable.id, orderId));

                        // Update local object to return fresh data immediately
                        order.refund_status = refund.status;
                        order.refund_speed = refund.speed_processed || order.refund_speed;
                        order.refund_completed_at = completedAt;
                        if (refund.status === 'processed') order.paymentStatus = 'refunded';
                        
                        console.log(`✅ Auto-synced refund status to: ${refund.status}`);
                    }
                } catch (syncErr) {
                    console.warn("⚠️ Failed to sync with Razorpay:", syncErr.message);
                    // Continue serving existing data if sync fails
                }
            }

            // 🟢 MODIFIED: Format order with variant data
            const formattedOrder = {
                ...order,
                userName: order.user?.name,
                phone: order.user?.phone,
                shippingAddress: order.address,
                // 🟢 FIXED: Key name changed from 'products' to 'orderItems' to match frontend list expectation
                orderItems: order.orderItems?.map((item) => ({
                    ...item.product,  // Spread main product (name, desc, images)
                    ...item.variant, // Spread variant (price, size, sku) - overrides any conflicts
                    productName: item.product.name, // Ensure main product name is used
                    variantName: item.variant.name, // e.g., "20ml"
                    quantity: item.quantity,
                    price: item.price, // Price at time of purchase
                    // 🟢 ADDED: Explicit fields required by frontend list view
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

// 🟢 POST to get a user's orders
router.post(
    "/get-my-orders",
    cache((req) => makeUserOrdersKey(req.body.userId), 300),
    async (req, res) => {
        try {
            const { userId } = req.body;
            if (!userId) return res.status(400).json({ error: "User ID is required" });

            // 🟢 MODIFIED: Updated relational query
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

            // Reshape data for frontend
            const formattedOrders = myOrders.map(order => ({
                ...order,
                orderItems: order.orderItems.map(item => ({
                    ...item,
                    productName: item.product?.name || 'N/A',
                    img: item.product?.imageurl?.[0] || '',
                    size: item.variant?.size || 'N/A',
                    // Keep item.price (price at purchase)
                }))
            }));

            res.json(formattedOrders);
        } catch (error) {
            console.error("❌ Error fetching user's orders:", error);
            res.status(500).json({ error: "Internal Server Error" });
        }
    }
);

// 🟢 PUT to update order status
router.put("/:id/status", async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!id || !status)
            return res.status(400).json({ error: "Order ID and status are required" });

        const [currentOrder] = await db
            .select()
            .from(ordersTable)
            .where(eq(ordersTable.id, id));

        const itemsToInvalidate = [];
        let orderItems = [];

        // --- LOGIC TO UPDATE 'SOLD' COUNT ---
        if (
            currentOrder &&
            currentOrder.status === "order placed" &&
            (status === "Processing" || status === "Shipped")
        ) {
            orderItems = await db
                .select({
                    quantity: orderItemsTable.quantity,
                    variantId: orderItemsTable.variantId, // 🟢 Get variantId
                    productId: orderItemsTable.productId, // 🟢 Get productId
                })
                .from(orderItemsTable)
                .where(eq(orderItemsTable.orderId, id));

            itemsToInvalidate.push({ key: makeAllProductsKey() });
            for (const item of orderItems) {
                // 🟢 MODIFIED: Update sold count on productVariantsTable
                await db
                    .update(productVariantsTable)
                    .set({ sold: sql`${productVariantsTable.sold} + ${item.quantity}` })
                    .where(eq(productVariantsTable.id, item.variantId));

                // Invalidate parent product and specific variant
                itemsToInvalidate.push({ key: makeProductKey(item.productId) });
            }
        }
        // --- END OF 'SOLD' COUNT LOGIC ---

        let newProgressStep = 1;
        if (status === "Processing") newProgressStep = 2;
        if (status === "Shipped") newProgressStep = 3;
        if (status === "Delivered") newProgressStep = 4;

        const [updatedOrder] = await db
            .update(ordersTable)
            .set({ status: status, progressStep: newProgressStep }) // Schema uses integer
            .where(eq(ordersTable.id, id))
            .returning();

        if (!updatedOrder)
            return res.status(404).json({ error: "Order not found" });

        let message = `Your order #${updatedOrder.id} is now ${status}.`;
        if (status === 'Delivered') {
            message = `Your order #${updatedOrder.id} has been delivered! We hope you enjoy it.`;
        } else if (status === 'Shipped') {
            message = `Good news! Your order #${updatedOrder.id} has shipped.`;
        }

        await createNotification(
            updatedOrder.userId,
            message,
            `/myorder`, // You can make this /myorder/${updatedOrder.id} if you build that page
            'order'
        );


        // 🟢 Add order keys to invalidation list
        itemsToInvalidate.push({ key: makeAllOrdersKey() });
        itemsToInvalidate.push({ key: makeOrderKey(updatedOrder.id) });
        itemsToInvalidate.push({ key: makeUserOrdersKey(updatedOrder.userId) });
        itemsToInvalidate.push({ key: makeAdminOrdersReportKey() }); // Report data changed

        // 🟢 Invalidate all caches at once
        await invalidateMultiple(itemsToInvalidate);

        res
            .status(200)
            .json({ message: "Order status updated successfully", updatedOrder });
    } catch (error) {
        console.error("❌ Error updating order status:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// 🟢 PUT to cancel an order (COD ONLY)
// Note: Online orders are cancelled via refundController, this route is for COD or generic cancel
router.put("/:id/cancel", async (req, res) => {
    try {
        const { id } = req.params;
        if (!id) return res.status(400).json({ error: "Order ID is required" });

        const [canceledOrder] = await db
            .update(ordersTable)
            .set({ status: "Order Cancelled" })
            // 🟢 FIXED: Changed "Order Placed" to "order placed" to match DB casing
            .where(eq(ordersTable.id, id))
            .returning();

        if (!canceledOrder)
            return res
                .status(404)
                .json({ error: "Order not found or cannot be canceled" });

        // 🟢 Build list of caches to invalidate
        const itemsToInvalidate = [
            { key: makeAllOrdersKey() },
            { key: makeOrderKey(canceledOrder.id) },
            { key: makeUserOrdersKey(canceledOrder.userId) },
            { key: makeAllProductsKey() }, // Stock is being restored
            { key: makeAdminOrdersReportKey() }, // Report data changed
        ];

        const orderItems = await db
            .select({
                quantity: orderItemsTable.quantity,
                variantId: orderItemsTable.variantId, // 🟢 Get variantId
                productId: orderItemsTable.productId, // 🟢 Get productId
            })
            .from(orderItemsTable)
            .where(eq(orderItemsTable.orderId, id));

        // --- 🟢 START: MODIFIED STOCK LOGIC ---
        for (const item of orderItems) {
            // 1. INCREASE STOCK OF THE COMBO WRAPPER (Your existing logic)
            await db
                .update(productVariantsTable)
                .set({ stock: sql`${productVariantsTable.stock} + ${item.quantity}` })
                .where(eq(productVariantsTable.id, item.variantId));

            // 🟢 Add product-specific key for the combo itself
            itemsToInvalidate.push({ key: makeProductKey(item.productId) });

            // (Bundle logic removed here as it's handled in refundController for online, 
            // but for COD this is sufficient if you aren't using complex bundles for COD)
        }
        // --- 🟢 END: MODIFIED STOCK LOGIC ---

        // 🟢 Invalidate all caches at once
        await invalidateMultiple(itemsToInvalidate);

        res
            .status(200)
            .json({ message: "Order canceled successfully", canceledOrder });
    } catch (error) {
        console.error("❌ Error canceling order:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// 🟢 GET /details/for-reports
router.get(
    "/details/for-reports",
    cache(makeAdminOrdersReportKey(), 3600),
    async (req, res) => {
        try {
            // 🟢 MODIFIED: Updated relational query
            const detailedOrders = await db.query.ordersTable.findMany({
                with: {
                    orderItems: {
                        with: {
                            product: true, // Gets the parent product
                            variant: true, // Gets the variant
                        },
                    },
                },
            });

            // 🟢 MODIFIED: Reshape data for frontend
            const reportData = detailedOrders.map((order) => ({
                ...order,
                products: order.orderItems.map((item) => ({
                    ...item.product, // Spread parent product (name, desc, category)
                    ...item.variant, // Spread variant (costPrice, size, oprice)
                    price: item.price, // Use the price from the order item (price at purchase)
                    quantity: item.quantity,
                })),
                orderItems: undefined, // Clean up
            }));

            res.json(reportData);
        } catch (error) {
            console.error("❌ Error fetching detailed orders for reports:", error);
            res.status(500).json({ error: "Server error" });
        }
    }
);

export default router;