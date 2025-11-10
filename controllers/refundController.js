import Razorpay from 'razorpay';
import { db } from '../configs/index.js';
// 🟢 FIX: Import all required tables
import {
    ordersTable,
    orderItemsTable,
    productsTable,
    productVariantsTable,
    productBundlesTable // 👈 Keep this for bundle content lookup
} from '../configs/schema.js';
import { eq, sql } from 'drizzle-orm';
// Import new helpers
import { invalidateMultiple } from '../invalidateHelpers.js';
import {
    makeAllProductsKey,
    makeProductKey,
    makeAllOrdersKey,
    makeUserOrdersKey,
    makeOrderKey,
} from '../cacheKeys.js';
import { createNotification } from '../helpers/notificationManager.js'; // 👈 1. IMPORT


export const refundOrder = async (req, res) => {
    const razorpay = new Razorpay({
        key_id: process.env.RAZORPAY_ID_KEY,
        key_secret: process.env.RAZORPAY_SECRET_KEY,
    });

    try {
        const { orderId, amount } = req.body;
        if (!orderId || !amount) {
            return res.status(400).json({ success: false, error: "Missing orderId or amount" });
        }

        // Step 1: Fetch order from DB (Unchanged)
        const [order] = await db
            .select({
                paymentId: ordersTable.transactionId,
                status: ordersTable.status,
                refundId: ordersTable.refund_id,
                userId: ordersTable.userId,
            })
            .from(ordersTable)
            .where(eq(ordersTable.id, orderId));

        if (!order) {
            return res.status(404).json({ success: false, error: "Order not found" });
        }
        // 🟢 MODIFIED: Allow refunding from 'Order Placed' or 'Processing' etc.
        // You might want to adjust this logic based on your business rules.
        if (order.status === "Delivered" || order.status === "Order Cancelled") {
            return res.status(400).json({ success: false, error: `Cannot refund an order that is already ${order.status}` });
        }
        if (order.refundId) {
            return res.status(400).json({ success: false, error: "Refund already initiated" });
        }
        if (!order.paymentId) {
            // This is a COD order, just update status
            await db
                .update(ordersTable)
                .set({
                    status: "Order Cancelled",
                    paymentStatus: 'cancelled',
                    updatedAt: new Date(),
                })
                .where(eq(ordersTable.id, orderId));

            await createNotification(
                order.userId,
                `Your COD order #${orderId} has been successfully cancelled.`,
                `/myorder`,
                'order'
            );
            // We still need to restore stock for COD orders
            // (Proceed to Step 8)
        } else {
            // --- Online Payment Refund Logic (Steps 2-7) ---

            // Step 2: Convert amount to paise (Unchanged)
            const amountInPaise = Math.round(amount * 100);
            let refundInPaise = Math.round(amountInPaise * 0.95);
            if (refundInPaise < 100) {
                refundInPaise = amountInPaise;
            }

            // Step 3: Fetch payment (Unchanged)
            const payment = await razorpay.payments.fetch(order.paymentId);

            // Step 4: Validate (Unchanged)
            const alreadyRefunded = (payment.refunds || []).reduce((sum, r) => sum + (r.amount || 0), 0);
            const maxRefundable = payment.amount - alreadyRefunded;
            if (refundInPaise > maxRefundable) {
                return res.status(400).json({
                    success: false,
                    error: `Refund amount exceeds remaining refundable amount ₹${(maxRefundable / 100).toFixed(2)}.`,
                });
            }

            // Step 5: Call refund (Unchanged)
            const refundInit = await razorpay.payments.refund(order.paymentId, {
                amount: refundInPaise,
                speed: 'normal',
            });

            // Step 6: Fetch accurate refund status (Unchanged)
            const refund = await razorpay.refunds.fetch(refundInit.id);

            // Step 7: Persist refund data in DB (Unchanged)
            await db
                .update(ordersTable)
                .set({
                    status: "Order Cancelled",
                    paymentStatus: 'refunded',
                    refund_id: refund.id,
                    refund_amount: refund.amount,
                    refund_status: refund.status,
                    refund_speed: refund.speed_processed,
                    refund_initiated_at: new Date(refund.created_at * 1000),
                    refund_completed_at: refund.status === 'processed'
                        ? new Date(refund.processed_at * 1000)
                        : null,
                    updatedAt: new Date(),
                })
                .where(eq(ordersTable.id, orderId));
        }


        await createNotification(
            order.userId,
            `Your refund for order #${orderId} has been ${refund.status}.`,
            `/myorder`,
            'order'
        );

        // 🟢 --- START: Step 8: Restore stock logic (FIXED for bundles) ---
        // (This now runs for both COD and Online refunds)

        // Get all items from the order
        const orderItems = await db
            .select({
                variantId: orderItemsTable.variantId, // 👈 Get variantId
                quantity: orderItemsTable.quantity,
                productId: orderItemsTable.productId, // 👈 Get parent productId for cache
            })
            .from(orderItemsTable)
            .where(eq(orderItemsTable.orderId, orderId));

        const affectedProductIds = new Set(); // To collect all products for cache invalidation
        const itemsToInvalidate = [
            { key: makeAllProductsKey(), prefix: true },
            { key: makeAllOrdersKey(), prefix: true },
            { key: makeOrderKey(orderId) },
            { key: makeUserOrdersKey(order.userId) },
        ];

        for (const item of orderItems) {
            // Add the item's main product ID to the set (the combo wrapper)
            affectedProductIds.add(item.productId);

            // 1. Restore stock to the COMBO WRAPPER variant itself
            await db
                .update(productVariantsTable) // 👈 Update productVariantsTable
                .set({ stock: sql`${productVariantsTable.stock} + ${item.quantity}` })
                .where(eq(productVariantsTable.id, item.variantId)); // 👈 For the combo's variant ID

            // 2. Check if this item is a bundle
            const bundleContents = await db
                .select()
                .from(productBundlesTable)
                .where(eq(productBundlesTable.bundleVariantId, item.variantId));

            if (bundleContents.length > 0) {
                // 3. IT IS A BUNDLE: Restore stock for each of its contents
                for (const content of bundleContents) {
                    const stockToRestore = content.quantity * item.quantity;

                    await db
                        .update(productVariantsTable) // 👈 Update productVariantsTable
                        .set({ stock: sql`${productVariantsTable.stock} + ${stockToRestore}` })
                        .where(eq(productVariantsTable.id, content.contentVariantId)); // 👈 For the content's ID

                    // Find the parent product of this content item for cache invalidation
                    const [contentVariant] = await db.select({ productId: productVariantsTable.productId }).from(productVariantsTable).where(eq(productVariantsTable.id, content.contentVariantId));
                    if (contentVariant) {
                        affectedProductIds.add(contentVariant.productId); // Add the content's product ID
                    }
                }
            }
        }
        // 🟢 --- END: Step 8: Restore stock logic ---


        // 🟢 --- Step 9: Invalidate caches ---
        // Add all unique product IDs to the invalidation list
        for (const pid of affectedProductIds) {
            itemsToInvalidate.push({ key: makeProductKey(pid), prefix: true });
        }

        await invalidateMultiple(itemsToInvalidate);
        // 🟢 --- END: Step 9: Invalidate caches ---

        return res.json({ success: true, message: "Order successfully cancelled and stock restored." });

    } catch (err) {
        console.error("refundOrder error:", err);
        if (err.statusCode) {
            return res.status(err.statusCode).json({ success: false, error: err.error?.description || err.message });
        }
        return res.status(500).json({ success: false, error: "Internal Server Error" });
    }
};