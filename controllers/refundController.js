/* eslint-disable */
import Razorpay from 'razorpay';
import { db } from '../configs/index.js';
import {
    ordersTable,
    orderItemsTable,
    productsTable,
    productVariantsTable,
    productBundlesTable,
    activityLogsTable,
    usersTable // 🟢 Added
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
        const { orderId, amount } = req.body; 
        
        // 🔒 AUTHENTICATION
        const requesterClerkId = req.auth.userId; 
        const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, requesterClerkId));
        if (!user) return res.status(401).json({ success: false, error: "Unauthorized" });

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

        // 🔒 AUTHORIZATION CHECK (Owner or Admin)
        if (order.userId !== user.id && user.role !== 'admin') {
            return res.status(403).json({ success: false, error: "Forbidden: Not your order" });
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
            const refundBaseAmount = amount || order.totalAmount;
            const amountInPaise = Math.round(refundBaseAmount * 100);
            
            let refundInPaise = Math.round(amountInPaise * 0.95);
            if (refundInPaise < 100) refundInPaise = amountInPaise;

            const payment = await razorpay.payments.fetch(order.paymentId);
            const alreadyRefunded = (payment.refunds || []).reduce((sum, r) => sum + (r.amount || 0), 0);
            const maxRefundable = payment.amount - alreadyRefunded;
            
            if (refundInPaise > maxRefundable) {
                return res.status(400).json({
                    success: false,
                    error: `Refund amount exceeds remaining refundable amount.`,
                });
            }

            const refundInit = await razorpay.payments.refund(order.paymentId, {
                amount: refundInPaise,
                speed: 'optimum',
            });

            refund = await razorpay.refunds.fetch(refundInit.id);
            refundAmountRecorded = refund.amount / 100;

            const initiatedAt = refund.created_at ? safeDate(refund.created_at) : new Date();
            const completedAt = (refund.status === 'processed' && refund.processed_at)
                ? safeDate(refund.processed_at)
                : null;

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
                    sold: sql`${productVariantsTable.sold} - ${item.quantity}`
                })
                .where(eq(productVariantsTable.id, item.variantId));

            // 2. Check if Bundle
            const bundleContents = await db
                .select()
                .from(productBundlesTable)
                .where(eq(productBundlesTable.bundleVariantId, item.variantId));

            if (bundleContents.length > 0) {
                for (const content of bundleContents) {
                    const stockToRestore = content.quantity * item.quantity;
                    await db
                        .update(productVariantsTable)
                        .set({ 
                            stock: sql`${productVariantsTable.stock} + ${stockToRestore}`,
                            sold: sql`${productVariantsTable.sold} - ${stockToRestore}`
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

        for (const pid of affectedProductIds) {
            itemsToInvalidate.push({ key: makeProductKey(pid), prefix: true });
        }

        await invalidateMultiple(itemsToInvalidate);

        // 🟢 --- Step 10: Log Activity ---
        await db.insert(activityLogsTable).values({
            userId: user.id, 
            action: 'ORDER_CANCEL_USER',
            description: `Cancelled Order #${orderId}`,
            performedBy: user.role === 'admin' ? 'admin' : 'user',
            metadata: { orderId, refundAmount: refundAmountRecorded }
        });

        return res.json({ success: true, message: "Order successfully cancelled and stock restored." });

    } catch (err) {
        console.error("refundOrder error:", err);
        if (err.statusCode) {
            return res.status(err.statusCode).json({ success: false, error: err.error?.description || err.message });
        }
        return res.status(500).json({ success: false, error: "Internal Server Error" });
    }
};