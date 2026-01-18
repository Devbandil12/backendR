import Razorpay from 'razorpay';
import { db } from '../configs/index.js';
import {
    ordersTable,
    orderItemsTable,
    productsTable,
    productVariantsTable,
    productBundlesTable,
    activityLogsTable // 🟢 Added for logging
} from '../configs/schema.js';
import { eq, sql } from 'drizzle-orm';
import { invalidateMultiple } from '../invalidateHelpers.js';
import {
    makeAllProductsKey,
    makeProductKey,
    makeAllOrdersKey,
    makeUserOrdersKey,
    makeOrderKey,
} from '../cacheKeys.js';
import { createNotification } from '../helpers/notificationManager.js';

// 🟢 Helper: Safely convert timestamp to Date object
const safeDate = (timestamp) => {
    if (!timestamp || isNaN(timestamp)) return null;
    return new Date(timestamp * 1000);
};

export const refundOrder = async (req, res) => {
    const razorpay = new Razorpay({
        key_id: process.env.RAZORPAY_ID_KEY,
        key_secret: process.env.RAZORPAY_SECRET_KEY,
    });

    try {
        const { orderId, amount, actorId } = req.body; // 🟢 Added actorId support
        
        if (!orderId) {
            return res.status(400).json({ success: false, error: "Missing orderId" });
        }

        // Step 1: Fetch order from DB
        const [order] = await db
            .select({
                paymentId: ordersTable.transactionId,
                status: ordersTable.status,
                refundId: ordersTable.refund_id,
                userId: ordersTable.userId,
                paymentMode: ordersTable.paymentMode,
                totalAmount: ordersTable.totalAmount
            })
            .from(ordersTable)
            .where(eq(ordersTable.id, orderId));

        if (!order) {
            return res.status(404).json({ success: false, error: "Order not found" });
        }

        // 🟢 STRICT RESTRICTION: Only 'Order Placed' can be cancelled by User
        if (order.status.toLowerCase() !== 'order placed') {
            return res.status(400).json({ 
                success: false, 
                error: `You cannot cancel this order as it is already ${order.status}. Please contact support.` 
            });
        }

        if (order.refundId) {
            return res.status(400).json({ success: false, error: "Refund already initiated" });
        }

        let refund = null;
        let refundAmountRecorded = 0;

        // 🟢 SCENARIO A: COD ORDER
        if (order.paymentMode === 'cod' || !order.paymentId) {
            await db
                .update(ordersTable)
                .set({
                    status: "Order Cancelled",
                    paymentStatus: 'cancelled',
                    updatedAt: new Date(),
                })
                .where(eq(ordersTable.id, orderId));
        } 
        // 🟢 SCENARIO B: ONLINE ORDER
        else {
            // Use provided amount or default to total (safety fallback)
            const refundBaseAmount = amount || order.totalAmount;

            // Step 2: Convert amount to paise
            const amountInPaise = Math.round(refundBaseAmount * 100);
            
            // Apply Cancellation Fee (95% refund) if that is your policy
            let refundInPaise = Math.round(amountInPaise * 0.95);
            if (refundInPaise < 100) refundInPaise = amountInPaise;

            // Step 3: Fetch payment
            const payment = await razorpay.payments.fetch(order.paymentId);

            // Step 4: Validate
            const alreadyRefunded = (payment.refunds || []).reduce((sum, r) => sum + (r.amount || 0), 0);
            const maxRefundable = payment.amount - alreadyRefunded;
            
            if (refundInPaise > maxRefundable) {
                return res.status(400).json({
                    success: false,
                    error: `Refund amount exceeds remaining refundable amount ₹${(maxRefundable / 100).toFixed(2)}.`,
                });
            }

            // Step 5: Call refund
            const refundInit = await razorpay.payments.refund(order.paymentId, {
                amount: refundInPaise,
                speed: 'optimum',
            });

            // Step 6: Fetch accurate refund status
            refund = await razorpay.refunds.fetch(refundInit.id);
            refundAmountRecorded = refund.amount / 100;

            const initiatedAt = refund.created_at ? safeDate(refund.created_at) : new Date();
            const completedAt = (refund.status === 'processed' && refund.processed_at)
                ? safeDate(refund.processed_at)
                : null;

            // Step 7: Persist refund data in DB
            await db
                .update(ordersTable)
                .set({
                    status: "Order Cancelled",
                    paymentStatus: 'refunded',
                    refund_id: refund.id,
                    refund_amount: refund.amount,
                    refund_status: refund.status,
                    refund_speed: refund.speed_processed,
                    refund_initiated_at: initiatedAt,
                    refund_completed_at: completedAt,
                    updatedAt: new Date(),
                })
                .where(eq(ordersTable.id, orderId));
        }

        // Notification
        const notifMessage = refund
            ? `Your refund for order #${orderId} has been ${refund.status}.`
            : `Your order #${orderId} has been cancelled.`;

        await createNotification(
            order.userId,
            notifMessage,
            `/myorder`,
            'order'
        );

        // 🟢 --- Step 8: Restore stock & FIX SOLD COUNT ---
        const orderItems = await db
            .select({
                variantId: orderItemsTable.variantId,
                quantity: orderItemsTable.quantity,
                productId: orderItemsTable.productId,
            })
            .from(orderItemsTable)
            .where(eq(orderItemsTable.orderId, orderId));

        const affectedProductIds = new Set();
        const itemsToInvalidate = [
            { key: makeAllProductsKey(), prefix: true },
            { key: makeAllOrdersKey(), prefix: true },
            { key: makeOrderKey(orderId) },
            { key: makeUserOrdersKey(order.userId) },
        ];

        for (const item of orderItems) {
            affectedProductIds.add(item.productId);

            // 1. Restore stock & Reduce Sold for Main Item
            await db
                .update(productVariantsTable)
                .set({ 
                    stock: sql`${productVariantsTable.stock} + ${item.quantity}`,
                    sold: sql`${productVariantsTable.sold} - ${item.quantity}` // 🟢 FIX: Reduce Sold
                })
                .where(eq(productVariantsTable.id, item.variantId));

            // 2. Check if this item is a bundle
            const bundleContents = await db
                .select()
                .from(productBundlesTable)
                .where(eq(productBundlesTable.bundleVariantId, item.variantId));

            if (bundleContents.length > 0) {
                // 3. Restore stock & Reduce Sold for Bundle Contents
                for (const content of bundleContents) {
                    const stockToRestore = content.quantity * item.quantity;

                    await db
                        .update(productVariantsTable)
                        .set({ 
                            stock: sql`${productVariantsTable.stock} + ${stockToRestore}`,
                            sold: sql`${productVariantsTable.sold} - ${stockToRestore}` // 🟢 FIX: Reduce Sold
                        })
                        .where(eq(productVariantsTable.id, content.contentVariantId));

                    const [contentVariant] = await db.select({ productId: productVariantsTable.productId })
                        .from(productVariantsTable)
                        .where(eq(productVariantsTable.id, content.contentVariantId));
                    
                    if (contentVariant) {
                        affectedProductIds.add(contentVariant.productId);
                    }
                }
            }
        }

        // 🟢 --- Step 9: Invalidate caches ---
        for (const pid of affectedProductIds) {
            itemsToInvalidate.push({ key: makeProductKey(pid), prefix: true });
        }

        await invalidateMultiple(itemsToInvalidate);

        // 🟢 --- Step 10: Log Activity (If Actor ID present) ---
        if (actorId) {
            await db.insert(activityLogsTable).values({
                userId: actorId, 
                action: 'ORDER_CANCEL_USER',
                description: `Cancelled Order #${orderId}`,
                performedBy: 'user', // Assuming this endpoint is primarily for users
                metadata: { orderId, refundAmount: refundAmountRecorded }
            });
        }

        return res.json({ success: true, message: "Order successfully cancelled and stock restored." });

    } catch (err) {
        console.error("refundOrder error:", err);
        if (err.statusCode) {
            return res.status(err.statusCode).json({ success: false, error: err.error?.description || err.message });
        }
        return res.status(500).json({ success: false, error: "Internal Server Error" });
    }
};