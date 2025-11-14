// file routes/orders.js

import express from "express";
import { db } from "../configs/index.js";
import {
    orderItemsTable,
    ordersTable,
    productsTable,
    productVariantsTable, // 🟢 ADDED
    usersTable,
    productBundlesTable, // 🟢 IMPORTED for checking bundle contents on cancel
} from "../configs/schema.js";
import { eq, and, asc, sql } from "drizzle-orm";
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
    // 🟢 You'll need to create this in cacheKeys.js
    // makeVariantKey, 
} from "../cacheKeys.js";
import { createNotification } from '../helpers/notificationManager.js'; // 👈 1. IMPORT

const router = express.Router();

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

// 🟢 GET single order details
router.get(
    "/:id",
    cache((req) => makeOrderKey(req.params.id), 3600),
    async (req, res) => {
        try {
            const orderId = req.params.id;
            // 🟢 MODIFIED: Updated relational query
            const order = await db.query.ordersTable.findFirst({
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

            // 🟢 MODIFIED: Format order with variant data
            const formattedOrder = {
                ...order,
                userName: order.user?.name,
                phone: order.user?.phone,
                shippingAddress: order.address,
                products: order.orderItems?.map((item) => ({
                    ...item.product,  // Spread main product (name, desc, images)
                    ...item.variant, // Spread variant (price, size, sku) - overrides any conflicts
                    productName: item.product.name, // Ensure main product name is used
                    variantName: item.variant.name, // e.g., "20ml"
                    quantity: item.quantity,
                    price: item.price, // Price at time of purchase
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
                // itemsToInvalidate.push({ key: makeVariantKey(item.variantId) });
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

// 🟢 PUT to cancel an order
router.put("/:id/cancel", async (req, res) => {
    try {
        const { id } = req.params;
        if (!id) return res.status(400).json({ error: "Order ID is required" });

        const [canceledOrder] = await db
            .update(ordersTable)
            .set({ status: "Order Cancelled" })
            .where(and(eq(ordersTable.id, id), eq(ordersTable.status, "Order Placed")))
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

            // 2. CHECK IF IT'S A BUNDLE, AND INCREASE CONTENT STOCK
            const bundleContents = await db
                .select()
                .from(productBundlesTable)
                .where(eq(productBundlesTable.bundleVariantId, item.variantId));

            if (bundleContents.length > 0) {
                for (const content of bundleContents) {
                    const stockToIncrease = content.quantity * item.quantity;

                    // Get the content's product ID for cache invalidation
                    const [contentVariant] = await db.select({ productId: productVariantsTable.productId })
                        .from(productVariantsTable)
                        .where(eq(productVariantsTable.id, content.contentVariantId));

                    await db
                        .update(productVariantsTable)
                        .set({ stock: sql`${productVariantsTable.stock} + ${stockToIncrease}` })
                        .where(eq(productVariantsTable.id, content.contentVariantId));

                    if (contentVariant) {
                        itemsToInvalidate.push({ key: makeProductKey(contentVariant.productId) });
                    }
                }
            }
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