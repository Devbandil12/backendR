/* eslint-disable */
import Razorpay from 'razorpay';
import { db } from '../../../db/client.js';
import {
    ordersTable,
    orderItemsTable,
    productsTable,
    productVariantsTable,
    productBundlesTable,
    usersTable,
    orderTimeline, // 🟢 Added for timeline logging
    couponRedemptionsTable,
    refundsTable
} from '../../../db/schema/index.js';
import { audit } from '../../../infrastructure/audit/audit.service.js';
import { ACTOR_TYPES } from '../../../infrastructure/audit/audit.constants.js';
import { eq, sql } from 'drizzle-orm';
import { invalidateMultiple } from '../../../infrastructure/cache/cache.invalidate.js';
import {
    makeAllProductsKey,
    makeProductKey,
    makeAllOrdersKey,
    makeUserOrdersKey,
    makeOrderKey,
} from '../../../infrastructure/cache/cache.keys.js';
import { createNotification } from '../../../modules/notifications/notifications.service.js';
import { cancelOrder as cancelShiprocketOrder } from '../../../infrastructure/shipping/providers/shiprocket.js';

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
        const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, req.auth.userId));
                
        if (!user) {return res.status(401).json({ success: false, error: "Unauthorized" });}

        if (!orderId) {
            return res.status(400).json({ success: false, error: "Missing orderId" });
        }

        // Step 1: Fetch order from DB
        const [order] = await db
            .select({
                paymentId: ordersTable.transactionId,
                status: ordersTable.status,
                userId: ordersTable.userId,
                paymentMode: ordersTable.paymentMode,
                totalAmount: ordersTable.totalAmount,
                shiprocketOrderId: ordersTable.shiprocketOrderId,
                shiprocketShipmentId: ordersTable.shiprocketShipmentId,
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

        const CANCELLABLE_STATUSES = ['order placed', 'processing', 'packed'];
        if (!CANCELLABLE_STATUSES.includes(order.status.toLowerCase())) {
            return res.status(400).json({ 
                success: false, 
                error: `You cannot cancel this order as it is already ${order.status}. Please contact support.` 
            });
        }

        const existingRefunds = await db.select().from(refundsTable).where(eq(refundsTable.orderId, orderId)).limit(1);
        if (existingRefunds.length > 0) {
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

            const { recordRefund } = await import('../../orders/refunds.compatibility.js');
            await recordRefund({
                orderId,
                amount: refund.amount, // in paise
                refundStatus: refund.status, // lowercase: 'processed' / 'pending'
                gatewayRefundId: refund.id,
                refundSpeed: refund.speed_processed,
                reason: 'Customer cancelled order before shipping',
                createdAt: initiatedAt,
                completedAt: completedAt,
            });

            await db
                .update(ordersTable)
                .set({
                    status: "Order Cancelled",
                    updatedAt: new Date(),
                })
                .where(eq(ordersTable.id, orderId));
        }

        // 🟢 FIX: mark any coupon redemption tied to this order as 'cancelled' so
        // it stops permanently consuming a usage slot (maxUsagePerUser,
        // totalUsageLimit, and firstOrderOnly checks all filter on this status).
        await db.update(couponRedemptionsTable)
            .set({ status: 'cancelled' })
            .where(eq(couponRedemptionsTable.orderId, orderId));

        // 🟢 Attempt Shiprocket cancellation (CRITICAL FIX APPLIED)
        const shiprocketIdToCancel = order.shiprocketOrderId || order.shiprocketShipmentId;

        if (shiprocketIdToCancel) {
            try {
                console.log(`Attempting to cancel Shiprocket order ID: ${shiprocketIdToCancel}`);
                // Shiprocket cancel API expects an array of order IDs
                await cancelShiprocketOrder([shiprocketIdToCancel]);
                
                // Optional: Add a success note to the timeline
                await db.insert(orderTimeline).values({
                    orderId: orderId,
                    status: 'Order Cancelled',
                    title: 'Shiprocket Cancellation Successful',
                    description: `Shipment (Shiprocket ID: ${shiprocketIdToCancel}) was successfully cancelled with the courier.`,
                    timestamp: new Date()
                });

            } catch (shiprocketError) {
                console.error(`🚨 Shiprocket Cancellation Failed for Order ${orderId}:`, shiprocketError.message);

                // CRITICAL FIX: Log the failure to the timeline so admins see it
                await db.insert(orderTimeline).values({
                    orderId: orderId,
                    status: 'Order Cancelled',
                    title: '⚠️ ACTION REQUIRED: Shiprocket Cancel Failed',
                    description: `Auto-cancellation failed. You MUST manually cancel this order in the Shiprocket Dashboard to avoid shipping fees! (Shiprocket ID: ${shiprocketIdToCancel}). Reason: ${shiprocketError.message || 'API Error'}`,
                    timestamp: new Date()
                });
            }
        }

        // Main Timeline Entry for general cancellation
        await db.insert(orderTimeline).values({
            orderId: orderId,
            status: 'Order Cancelled',
            title: 'Order Cancelled',
            description: 'Your order was cancelled successfully.',
            timestamp: new Date()
        });

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
        await audit.log({
            actorUserId: user.id,
            actorType: user.role === 'admin' ? ACTOR_TYPES.ADMIN : ACTOR_TYPES.CUSTOMER,
            action: 'ORDER_CANCELLED_BY_USER',
            resourceType: 'ORDER',
            resourceId: orderId,
            resourceData: order,
            description: `Cancelled Order #${orderId}`,
            metadata: { refundAmount: refundAmountRecorded }
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

