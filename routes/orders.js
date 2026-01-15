// file routes/orders.js

import express from "express";
import Razorpay from "razorpay";
import { db } from "../configs/index.js";
import {
    orderItemsTable,
    ordersTable,
    productsTable,
    productVariantsTable,
    usersTable,
    activityLogsTable, // 🟢 IMPORTED: Activity Logs
    productBundlesTable // 🟢 IMPORTED: (Kept for bundle logic if needed)
} from "../configs/schema.js";
import { eq, asc, sql } from "drizzle-orm";
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

// GET all orders for admin panel
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
                paymentStatus: ordersTable.paymentStatus,
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

// GET single order details (WITH AUTO-SYNC and TRANSACTION)
router.get(
    "/:id",
    // Cache is removed to ensure "Refresh Status" works
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
                            product: true,
                            variant: true,
                        },
                    },
                },
            });

            if (!order) {
                return res.status(404).json({ error: "Order not found" });
            }

            // 🟢 2. AUTO-SYNC LOGIC: Trigger if refund is active AND (status is not terminal OR date is missing).
            const isRefundActive = order.refund_id;
            const isMissingData = 
                (order.refund_status !== 'processed' && order.refund_status !== 'failed') ||
                (order.refund_status === 'processed' && !order.refund_completed_at);

            if (isRefundActive && isMissingData) {
                try {
                    console.log(`🔄 Syncing refund status for ${order.refund_id}...`);
                    const refund = await razorpay.refunds.fetch(order.refund_id);

                    // If status has changed OR if status is processed but the date is missing
                    if (refund.status !== order.refund_status || (refund.status === 'processed' && !order.refund_completed_at)) {
                        
                        let completedAt;
                        
                        if (refund.status === 'processed') {
                            // 1. PRIMARY: Use the official Razorpay timestamp
                            if (refund.processed_at) {
                                completedAt = safeDate(refund.processed_at); 
                            } else {
                                // 2. FALLBACK: Use the current server time if Razorpay misses the timestamp
                                console.warn(`⚠️ Razorpay returned 'processed' but is missing processed_at for ${order.refund_id}. Using current time as fallback.`);
                                completedAt = new Date(); 
                            }
                        } else {
                             completedAt = null;
                        }

                        // 🟢 WRAP DB UPDATE AND CACHE INVALIDATION IN A TRANSACTION
                        await db.transaction(async (tx) => {
                            await tx.update(ordersTable).set({
                                refund_status: refund.status,
                                refund_speed: refund.speed_processed || order.refund_speed,
                                refund_completed_at: completedAt, // Fills the missing date (Rzp date or server time)
                                paymentStatus: refund.status === 'processed' ? 'refunded' : order.paymentStatus,
                                updatedAt: new Date(),
                            }).where(eq(ordersTable.id, orderId));

                            // Invalidate relevant caches only if DB update succeeds
                            await invalidateMultiple([
                                { key: makeOrderKey(order.id) },
                                { key: makeUserOrdersKey(order.userId) },
                                { key: makeAllOrdersKey() },
                            ]);
                        }); // Transaction commits here

                        // Update local object to return fresh data immediately
                        order.refund_status = refund.status;
                        order.refund_speed = refund.speed_processed || order.refund_speed;
                        order.refund_completed_at = completedAt;
                        if (refund.status === 'processed') order.paymentStatus = 'refunded';

                        console.log(`✅ Auto-synced refund status to: ${refund.status}`);
                    }
                } catch (syncErr) {
                    console.warn("⚠️ Failed to sync with Razorpay or DB transaction failed:", syncErr.message);
                    // Continue serving existing data if sync fails
                }
            }

            // MODIFIED: Format order with variant data
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

// NEW ENDPOINT: Generate and Download Invoice
router.get("/:id/invoice", async (req, res) => {
    try {
        const orderId = req.params.id;

        // 1. Fetch Order
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

        if (!order) {
            return res.status(404).json({ error: "Order not found" });
        }

        // 2. Format Address
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

        // FIX: Correctly access 'transactionId' from schema
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
                subtotal: items.reduce((sum, item) => sum + item.totalPrice, 0),
                discount: 0,
                delivery: 0,
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


// POST to get a user's orders
router.post(
    "/get-my-orders",
    cache((req) => makeUserOrdersKey(req.body.userId), 300),
    async (req, res) => {
        try {
            const { userId } = req.body;
            if (!userId) return res.status(400).json({ error: "User ID is required" });

            // MODIFIED: Updated relational query
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
                }))
            }));

            res.json(formattedOrders);
        } catch (error) {
            console.error("❌ Error fetching user's orders:", error);
            res.status(500).json({ error: "Internal Server Error" });
        }
    }
);

// 🟢 PUT to update order status (Modified for Logging)
router.put("/:id/status", async (req, res) => {
    try {
        const { id } = req.params;
        const { status, actorId } = req.body; // 🟢 Extract actorId

        if (!id || !status)
            return res.status(400).json({ error: "Order ID and status are required" });

        // Fetch current status for comparison
        const [currentOrder] = await db
            .select()
            .from(ordersTable)
            .where(eq(ordersTable.id, id));
        
        const oldStatus = currentOrder?.status;

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
                    variantId: orderItemsTable.variantId,
                    productId: orderItemsTable.productId,
                })
                .from(orderItemsTable)
                .where(eq(orderItemsTable.orderId, id));

            itemsToInvalidate.push({ key: makeAllProductsKey() });
            for (const item of orderItems) {
                // MODIFIED: Update sold count on productVariantsTable
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
            .set({ status: status, progressStep: newProgressStep })
            .where(eq(ordersTable.id, id))
            .returning();

        if (!updatedOrder)
            return res.status(404).json({ error: "Order not found" });

        // 🟢 LOG ACTIVITY
        if (actorId && oldStatus !== status) {
            await db.insert(activityLogsTable).values({
                userId: actorId, // Log under Admin ID
                action: 'ORDER_STATUS_UPDATE',
                description: `Updated Order #${id} status: ${oldStatus} → ${status}`,
                performedBy: 'admin',
                metadata: { orderId: id, oldStatus, newStatus: status }
            });
        }

        // 🟢 REFERRAL HOOK: Complete referral if Delivered
        if (status.toLowerCase() === 'delivered') {
            try {
                await processReferralCompletion(updatedOrder.userId);
            } catch (refError) {
                console.error("⚠️ Referral completion failed:", refError);
                // Don't fail the request, just log it
            }
        }
        
        // 🟢 SEND NOTIFICATION TO USER

        let message = `Your order #${updatedOrder.id} is now ${status}.`;
        if (status === 'Delivered') {
            message = `Your order #${updatedOrder.id} has been delivered! We hope you enjoy it.`;
        } else if (status === 'Shipped') {
            message = `Good news! Your order #${updatedOrder.id} has shipped.`;
        }

        await createNotification(
            updatedOrder.userId,
            message,
            `/myorder`,
            'order'
        );


        // Add order keys to invalidation list
        itemsToInvalidate.push({ key: makeAllOrdersKey() });
        itemsToInvalidate.push({ key: makeOrderKey(updatedOrder.id) });
        itemsToInvalidate.push({ key: makeUserOrdersKey(updatedOrder.userId) });
        itemsToInvalidate.push({ key: makeAdminOrdersReportKey() });

        // Invalidate all caches at once
        await invalidateMultiple(itemsToInvalidate);

        res
            .status(200)
            .json({ message: "Order status updated successfully", updatedOrder });
    } catch (error) {
        console.error("❌ Error updating order status:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// 🟢 PUT to cancel an order (Modified for Logging)
router.put("/:id/cancel", async (req, res) => {
    try {
        const { id } = req.params;
        const { actorId } = req.body; // 🟢 Extract actorId

        if (!id) return res.status(400).json({ error: "Order ID is required" });

        const [canceledOrder] = await db
            .update(ordersTable)
            .set({ status: "Order Cancelled" })
            .where(eq(ordersTable.id, id))
            .returning();

        if (!canceledOrder)
            return res
                .status(404)
                .json({ error: "Order not found or cannot be canceled" });

        // 🟢 LOG ACTIVITY
        if (actorId) {
            await db.insert(activityLogsTable).values({
                userId: actorId, // Log under Admin ID
                action: 'ORDER_CANCEL',
                description: `Cancelled Order #${id}`,
                performedBy: 'admin',
                metadata: { orderId: id }
            });
        }

        // Build list of caches to invalidate
        const itemsToInvalidate = [
            { key: makeAllOrdersKey() },
            { key: makeOrderKey(canceledOrder.id) },
            { key: makeUserOrdersKey(canceledOrder.userId) },
            { key: makeAllProductsKey() },
            { key: makeAdminOrdersReportKey() },
        ];

        const orderItems = await db
            .select({
                quantity: orderItemsTable.quantity,
                variantId: orderItemsTable.variantId,
                productId: orderItemsTable.productId,
            })
            .from(orderItemsTable)
            .where(eq(orderItemsTable.orderId, id));

        // 🟢 RESTORE STOCK LOGIC (Includes recursive bundle support)
        for (const item of orderItems) {
            
            // 1. Restore stock of the item itself
            await db
                .update(productVariantsTable)
                .set({ stock: sql`${productVariantsTable.stock} + ${item.quantity}` })
                .where(eq(productVariantsTable.id, item.variantId));

            // 2. CHECK IF BUNDLE -> Restore inner components
            const bundleContents = await db
                .select()
                .from(productBundlesTable)
                .where(eq(productBundlesTable.bundleVariantId, item.variantId));

            if (bundleContents.length > 0) {
                for (const content of bundleContents) {
                    const quantityToRestore = item.quantity * content.quantity;
                    await db
                        .update(productVariantsTable)
                        .set({ stock: sql`${productVariantsTable.stock} + ${quantityToRestore}` })
                        .where(eq(productVariantsTable.id, content.contentVariantId));
                }
            }

            // Add product-specific key
            itemsToInvalidate.push({ key: makeProductKey(item.productId) });
        }

        // Invalidate all caches at once
        await invalidateMultiple(itemsToInvalidate);

        res
            .status(200)
            .json({ message: "Order canceled successfully", canceledOrder });
    } catch (error) {
        console.error("❌ Error canceling order:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// GET /details/for-reports
router.get(
    "/details/for-reports",
    cache(makeAdminOrdersReportKey(), 3600),
    async (req, res) => {
        try {
            // MODIFIED: Updated relational query
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

            // MODIFIED: Reshape data for frontend
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
    }
);

export default router;