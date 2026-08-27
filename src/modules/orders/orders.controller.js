import * as OrdersService from "./orders.service.js";
import * as OrdersRepository from "./orders.repository.js";
import { invalidateMultiple } from "../../infrastructure/cache/cache.invalidate.js";
import {
  makeAllOrdersKey,
  makeOrderKey,
  makeUserOrdersKey,
  makeAllProductsKey,
  makeProductKey,
  makeAdminOrdersReportKey,
} from "../../infrastructure/cache/cache.keys.js";
import { generateInvoiceBuffer } from "../../infrastructure/invoicing/invoice.service.js"; 
import { db } from "../../db/client.js";
import { usersTable } from "../../db/schema/index.js";
import { eq } from "drizzle-orm";
import { audit } from "../../infrastructure/audit/audit.service.js";
import { ACTOR_TYPES } from "../../infrastructure/audit/audit.constants.js";
import * as ordersSse from "./orders.sse.js";

import { resolveEffectivePermissions, getUserWithRole } from "../../middleware/rbac.js";

const getUserFromToken = getUserWithRole;

import * as AdminService from "../admin/admin.service.js";

export const getDashboardStats = async (req, res) => {
  try {
    const { timeRange, startDate, endDate } = req.query;
    const stats = await AdminService.getDashboardStats(timeRange || 'month', startDate, endDate);
    res.json(stats);
  } catch (error) {
    console.error("Dashboard Stats Error:", error);
    res.status(500).json({ error: "Failed to load dashboard statistics" });
  }
};

export const getAttentionCounts = async (req, res) => {
  try {
    const counts = await AdminService.getAttentionCounts();
    res.json(counts);
  } catch (error) {
    console.error("Attention Counts Error:", error);
    res.status(500).json({ error: "Failed to load attention counts" });
  }
};



export const getOrderSummary = async (req, res) => {
  try {
    const summary = await OrdersRepository.getOrderSummary();
    res.json(summary);
  } catch (error) {
    console.error("❌ Error fetching order summary:", error);
    res.status(500).json({ error: "Server error" });
  }
};

export const getAllOrders = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const allOrders = await OrdersRepository.getAllOrders(req.query);
    
    allOrders.data = allOrders.data.map(order => ({
      ...order,
      ...OrdersService.computeAttention(order)
    }));

    res.json(allOrders);
  } catch (error) {
    console.error("❌ Error fetching all orders:", error);
    res.status(500).json({ error: "Server error" });
  }
};

export const getOrderById = async (req, res) => {
  try {
    const orderId = req.params.id;
    const requester = await getUserFromToken(req.auth.userId);
    if (!requester) return res.status(401).json({ error: "Unauthorized" });

    let order = await OrdersRepository.getOrderByIdWithDetails(orderId);
    if (!order) return res.status(404).json({ error: "Order not found" });

    const isAuthorized = order.userId === requester.id || requester.role === 'admin' || !!requester.adminRole || requester.permissions?.includes('orders.view');
    if (!isAuthorized) {
      return res.status(403).json({ error: "Forbidden: You cannot view this order." });
    }

    order = await OrdersService.syncRazorpayRefundStatus(order);
    
    const finalTimeline = OrdersService.getOrderTimeline(order);

    const normalizedRefunds = (order.refunds || []).map(r => {
      const amt = Number(r.amount) || 0;
      return {
        ...r,
        amount: amt,
        displayAmount: (amt >= 100 ? (amt / 100) : amt).toFixed(2),
        refundStatus: String(r.refundStatus || 'pending').toLowerCase()
      };
    });

    const orderTotalRupees = Number(order.totalAmount || 0) + Number(order.walletAmountUsed || 0);
    const orderTotalPaise = Math.round(orderTotalRupees * 100);
    const alreadyRefundedPaise = normalizedRefunds
      .filter(r => r.refundStatus === 'processed' || r.refundStatus === 'in_progress')
      .reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
    const remainingRefundablePaise = Math.max(0, orderTotalPaise - alreadyRefundedPaise);

    const financialSummary = {
      orderTotal: orderTotalRupees,
      orderTotalPaise,
      alreadyRefunded: alreadyRefundedPaise / 100,
      alreadyRefundedPaise,
      remainingRefundable: remainingRefundablePaise / 100,
      remainingRefundablePaise,
      canRefund: remainingRefundablePaise > 0
    };

    const formattedOrder = {
      ...order,
      userName: order.user?.name,
      phone: order.user?.phone,
      shippingAddress: order.address,
      timeline: finalTimeline,
      orderItems: (order.orderItems || []).map((item) => {
        let displayImg = item.img || '';
        if (!displayImg && item.product?.imageurl) {
          if (Array.isArray(item.product.imageurl)) {
            displayImg = item.product.imageurl[0] || '';
          } else if (typeof item.product.imageurl === 'string') {
            displayImg = item.product.imageurl;
          }
        }
        return {
          id: item.id,
          orderItemId: item.id,
          productId: item.productId,
          productName: item.product?.name || item.productName || 'Product',
          variantName: item.variant?.name || item.variantName || (item.size ? `${item.size}ml` : 'Standard'),
          quantity: item.quantity || 1,
          price: item.price || 0,
          totalPrice: item.totalPrice || ((item.price || 0) * (item.quantity || 1)),
          img: displayImg || '/fallback.png',
          size: item.size || item.variant?.size || 'N/A',
        };
      }),
      items: (order.orderItems || []).map((item) => ({
        id: item.id,
        orderItemId: item.id,
        productId: item.productId,
        productName: item.product?.name || item.productName || 'Product',
        variantName: item.variant?.name || item.variantName || (item.size ? `${item.size}ml` : 'Standard'),
        quantity: item.quantity || 1,
        price: item.price || 0,
        totalPrice: item.totalPrice || ((item.price || 0) * (item.quantity || 1)),
        img: item.img || '/fallback.png',
        size: item.size || item.variant?.size || 'N/A',
      })),
      refunds: normalizedRefunds,
      financialSummary,
      user: undefined,
      address: undefined,
      ...OrdersService.computeAttention(order),
    };

    if (requester.role === 'admin' && order.userId) {
       formattedOrder.customerStats = await OrdersRepository.getCustomerStats(order.userId);
    }

    res.json(formattedOrder);
  } catch (error) {
    console.error("❌ Error fetching order details:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const getInvoice = async (req, res) => {
  try {
    const orderId = req.params.id;
    const requester = await getUserFromToken(req.auth.userId);
    if (!requester) return res.status(401).json({ error: "Unauthorized" });

    const order = await OrdersRepository.getOrderByIdWithDetails(orderId);
    if (!order) return res.status(404).json({ error: "Order not found" });

    const isAuthorized = order.userId === requester.id || requester.role === 'admin' || !!requester.adminRole || requester.permissions?.includes('orders.view');
    if (!isAuthorized) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const addr = order.address || {};
    const formattedAddress = [
      addr.address, addr.landmark, `${addr.city}, ${addr.state}`, `${addr.country} - ${addr.postalCode}`
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
    if (!txnId || txnId === "null" || txnId === "undefined") txnId = null;

    const invoiceNo = order.invoiceNumber || `INV-LEGACY-${order.id.slice(0, 8)}`;

    const orderData = {
      id: order.id,
      orderId: order.id,
      createdAt: order.createdAt,
      paymentMode: order.paymentMode,
      transactionId: txnId,
      invoiceNumber: invoiceNo,
      shippingState: addr.state,
      totals: {
        subtotal: subtotal,
        discount: totalDiscount,
        walletUsed: walletUsed,
        delivery: deliveryCharge,
        grandTotal: order.totalAmount
      }
    };

    const pdfBuffer = await generateInvoiceBuffer({
      order: orderData,
      items: items,
      billing: billing
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${invoiceNo}.pdf"`);
    return res.send(pdfBuffer);

  } catch (error) {
    console.error("❌ Error generating invoice:", error);
    res.status(500).json({ error: "Failed to generate invoice" });
  }
};

export const getMyOrders = async (req, res) => {
  try {
    const user = await getUserFromToken(req.auth.userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    const myOrders = await OrdersRepository.getUserOrders(user.id);

    const formattedOrders = myOrders.map(order => {
      const finalTimeline = OrdersService.getOrderTimeline(order);
      return {
        ...order,
        timeline: finalTimeline,
        orderItems: order.orderItems.map(item => ({
          ...item,
          productName: item.product?.name || 'N/A',
          img: item.product?.imageurl?.[0] || '',
          size: item.variant?.size || 'N/A',
        }))
      };
    });

    res.json(formattedOrders);
  } catch (error) {
    console.error("❌ Error fetching user's orders:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const updateStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, message, version, expectedVersion } = req.body;

    if (!id || !status) return res.status(400).json({ error: "Order ID and status are required" });

    const adminUser = await getUserFromToken(req.auth.userId);
    const actorId = adminUser?.id;

    const parsedVersion = version !== undefined ? Number(version) : (expectedVersion !== undefined ? Number(expectedVersion) : null);
    const updatedOrder = await OrdersService.updateOrderStatus(id, status, message, actorId, parsedVersion);

    await invalidateMultiple([
      { key: makeAllOrdersKey(), prefix: true },
      { key: makeOrderKey(updatedOrder.id) },
      { key: makeUserOrdersKey(updatedOrder.userId) },
      { key: makeAdminOrdersReportKey() }
    ]);

    res.status(200).json({ message: "Order status updated", updatedOrder });
  } catch (error) {
    if (error.message?.includes("ConcurrencyConflict")) {
      return res.status(409).json({ error: error.message, isConflict: true });
    }
    if (error.message?.includes("Action Blocked") || error.message?.includes("Order not found")) {
      return res.status(400).json({ error: error.message });
    }
    console.error("❌ Error updating order status:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const cancelOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const { version, expectedVersion } = req.body;
    if (!id) return res.status(400).json({ error: "Order ID is required" });

    const adminUser = await getUserFromToken(req.auth.userId);
    const actorId = adminUser?.id;

    const parsedVersion = version !== undefined ? Number(version) : (expectedVersion !== undefined ? Number(expectedVersion) : null);
    const { order, itemsToInvalidate } = await OrdersService.cancelOrder(id, actorId, parsedVersion);

    const cacheKeys = [
      { key: makeAllOrdersKey(), prefix: true },
      { key: makeOrderKey(id) },
      { key: makeUserOrdersKey(order.userId) },
      { key: makeAllProductsKey() },
      ...itemsToInvalidate.map(pid => ({ key: makeProductKey(pid) }))
    ];

    await invalidateMultiple(cacheKeys);

    res.json({ message: "Order cancelled by Admin" });
  } catch (error) {
    if (error.message?.includes("ConcurrencyConflict")) {
      return res.status(409).json({ error: error.message, isConflict: true });
    }
    if (error.message === "Order not found") return res.status(404).json({ error: error.message });
    if (error.message === "Order is already cancelled") return res.status(400).json({ error: error.message });
    console.error("Admin Cancel Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const getReportDetails = async (req, res) => {
  try {
    const reportData = await OrdersService.getOrdersForReportsFormatted();
    res.json(reportData);
  } catch (error) {
    console.error("❌ Error fetching detailed orders for reports:", error);
    res.status(500).json({ error: "Server error" });
  }
};

export const bulkStatusUpdate = async (req, res) => {
  try {
    const { orderIds, status } = req.body;
    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({ error: "No order IDs provided" });
    }
    if (!status) return res.status(400).json({ error: "Status is required" });

    const adminUser = await getUserFromToken(req.auth.userId);
    const actorId = adminUser?.id;

    const { updatedOrders, eligibleCount, skipped } = await OrdersService.bulkUpdateStatus(orderIds, status, actorId);

    const itemsToInvalidate = [
      { key: makeAllOrdersKey(), prefix: true },
      { key: makeAdminOrdersReportKey() },
      ...updatedOrders.map(o => ({ key: makeOrderKey(o.id) })),
      ...updatedOrders.map(o => ({ key: makeUserOrdersKey(o.userId) }))
    ];

    await invalidateMultiple(itemsToInvalidate);

    res.json({
      success: true,
      message: `Successfully updated ${updatedOrders.length} out of ${orderIds.length} orders to ${status}`,
      count: updatedOrders.length,
      eligibleCount,
      skipped
    });
  } catch (error) {
    if (error.message.includes("Cannot bulk ship")) {
      return res.status(400).json({ error: error.message });
    }
    console.error("❌ Bulk update error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const shipPreview = async (req, res) => {
  try {
    const { orderIds } = req.body;
    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({ error: "No order IDs provided" });
    }

    const pickupPincode = process.env.SHIPROCKET_PICKUP_PINCODE;
    if (!pickupPincode) {
      return res.status(500).json({ error: "SHIPROCKET_PICKUP_PINCODE is not configured." });
    }

    const { results, totalEstimate } = await OrdersService.getShipPreview(orderIds, pickupPincode);
    res.json({ success: true, results, totalEstimate });
  } catch (error) {
    console.error("❌ Ship preview error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const shipNow = async (req, res) => {
  try {
    const { orders: shipRequests } = req.body;
    if (!shipRequests || !Array.isArray(shipRequests) || shipRequests.length === 0) {
      return res.status(400).json({ error: "No orders provided" });
    }

    const { results, timelineValues } = await OrdersService.shipNow(shipRequests);

    const itemsToInvalidate = [
      { key: makeAllOrdersKey(), prefix: true }, 
      { key: makeAdminOrdersReportKey() }
    ];

    results.filter(r => r.success).forEach(r => {
       itemsToInvalidate.push({ key: makeOrderKey(r.orderId) });
    });

    await invalidateMultiple(itemsToInvalidate);

    const successCount = results.filter(r => r.success).length;
    res.json({
      success: true,
      message: `Shipped ${successCount} of ${shipRequests.length} orders.`,
      results,
    });
  } catch (error) {
    console.error("❌ Ship now error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const initiateReturn = async (req, res) => {
  try {
    const { id } = req.params;
    const requester = await getUserFromToken(req.auth.userId);
    if (!requester) return res.status(401).json({ error: "Unauthorized" });

    const { order, shiprocketRes } = await OrdersService.initiateReturn(id, requester);

    await invalidateMultiple([
      { key: makeOrderKey(order.id) },
      { key: makeUserOrdersKey(order.userId) },
      { key: makeAllOrdersKey(), prefix: true }
    ]);

    res.json({ message: "Return initiated successfully", shiprocketRes });
  } catch (error) {
    if (error.message.includes("Forbidden") || error.message.includes("Order not found") || error.message.includes("not delivered")) {
      return res.status(error.message.includes("not found") ? 404 : (error.message.includes("Forbidden") ? 403 : 400)).json({ error: error.message });
    }
    console.error("❌ Return initiation failed:", error.message);
    res.status(500).json({ error: "Failed to initiate return. " + error.message });
  }
};

export const addOrderNote = async (req, res) => {
  try {
    const { id } = req.params;
    const { note } = req.body;
    
    if (!id) return res.status(400).json({ error: "Order ID is required" });
    if (!note) return res.status(400).json({ error: "Note content is required" });

    const adminUser = await getUserFromToken(req.auth.userId);
    if (!adminUser) return res.status(401).json({ error: "Unauthorized" });

    const savedNote = await OrdersService.addOrderNote(id, adminUser.id, note);
    
    // Invalidate order cache
    await invalidateMultiple([{ key: makeOrderKey(id) }]);

    res.json({ success: true, note: savedNote });
  } catch (error) {
    console.error("❌ Error adding order note:", error);
    res.status(500).json({ error: "Failed to add order note" });
  }
};

export const initiateAdminReturn = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason, adminNotes, items, version, expectedVersion } = req.body; // items: [{ orderItemId, quantity, condition }]
    const requester = await getUserFromToken(req.auth.userId);

    const order = await OrdersRepository.getOrderById(id);
    if (!order) return res.status(404).json({ error: "Order not found" });

    const parsedVersion = version !== undefined ? Number(version) : (expectedVersion !== undefined ? Number(expectedVersion) : null);
    const newReturn = await OrdersRepository.insertAdminReturn(id, order.userId, reason, adminNotes, items, parsedVersion);

    if (requester?.id) {
      await audit.log({
        actorUserId: requester.id,
        actorType: ACTOR_TYPES.ADMIN,
        action: 'ORDER_RETURN_INITIATED',
        resourceType: 'ORDER',
        resourceId: id,
        description: `Admin initiated return for Order #${id}: ${reason}`,
        metadata: { returnId: newReturn.id, reason, itemsCount: items?.length || 0 }
      });
    }

    ordersSse.broadcastOrderEvent('RETURN_UPDATED', {
      orderId: id,
      returnId: newReturn.id,
      reason
    }, order.userId);

    await invalidateMultiple([{ key: makeOrderKey(id) }, { key: makeAllOrdersKey(), prefix: true }]);
    res.json({ success: true, returnData: newReturn });
  } catch (error) {
    if (error.message?.includes("ConcurrencyConflict")) {
      return res.status(409).json({ error: error.message, isConflict: true });
    }
    console.error("❌ Error initiating admin return:", error);
    res.status(500).json({ error: "Failed to initiate return" });
  }
};

export const initiateAdminRefund = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, reason, gatewayRefundId, returnId, version, expectedVersion } = req.body;
    const requester = await getUserFromToken(req.auth.userId);

    const order = await OrdersRepository.getOrderById(id);
    if (!order) return res.status(404).json({ error: "Order not found" });

    const parsedVersion = version !== undefined ? Number(version) : (expectedVersion !== undefined ? Number(expectedVersion) : null);
    const newRefund = await OrdersRepository.insertAdminRefund(id, amount, reason, gatewayRefundId, returnId, parsedVersion);

    if (requester?.id) {
      await audit.log({
        actorUserId: requester.id,
        actorType: ACTOR_TYPES.ADMIN,
        action: 'ORDER_REFUND_INITIATED',
        resourceType: 'ORDER',
        resourceId: id,
        description: `Admin initiated refund for Order #${id}: ₹${amount}`,
        metadata: { refundId: newRefund.id, amount, reason, returnId }
      });
    }

    ordersSse.broadcastOrderEvent('REFUND_UPDATED', {
      orderId: id,
      refundId: newRefund.id,
      amount,
      reason
    }, order.userId);

    await invalidateMultiple([{ key: makeOrderKey(id) }, { key: makeAllOrdersKey(), prefix: true }]);
    res.json({ success: true, refundData: newRefund });
  } catch (error) {
    if (error.message?.includes("ConcurrencyConflict")) {
      return res.status(409).json({ error: error.message, isConflict: true });
    }
    if (error.message?.startsWith("RefundExceedsOrderTotal") || error.message?.startsWith("RefundAmountInvalid")) {
      return res.status(400).json({ error: error.message.replace(/^[^:]+:\s*/, '') });
    }
    console.error("❌ Error initiating admin refund:", error);
    res.status(500).json({ error: error.message || "Failed to initiate refund" });
  }
};

export const streamOrderEvents = async (req, res) => {
  const clerkId = req.auth?.userId;
  if (!clerkId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  
  res.write('\n');

  try {
    const user = await getUserFromToken(clerkId);
    const role = user?.role === 'admin' ? 'admin' : 'user';
    
    ordersSse.addOrderSseClient(clerkId, role, res);

    req.on('close', () => {
      ordersSse.removeOrderSseClient(clerkId, res);
    });
  } catch (err) {
    console.error('❌ Orders SSE Error:', err);
    res.end();
  }
};
