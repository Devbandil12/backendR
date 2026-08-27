import * as OrdersRepository from "./orders.repository.js";
import Razorpay from "razorpay";
import { cancelOrder as cancelShiprocketOrder, createReturnOrder, assignAwb, getServiceability } from "../../infrastructure/shipping/providers/shiprocket.js";
import { processReferralCompletion } from "../referrals/referrals.controller.js";
import { createNotification } from '../../modules/notifications/notifications.service.js';
import { audit } from '../../infrastructure/audit/audit.service.js';
import { ACTOR_TYPES } from '../../infrastructure/audit/audit.constants.js';
import { isValidTransition, FULFILLMENT_STATES } from './orders.stateMachine.js';
import { broadcastOrderEvent } from './orders.sse.js';

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_ID_KEY,
  key_secret: process.env.RAZORPAY_SECRET_KEY,
});

const safeDate = (timestamp) => {
  if (!timestamp || isNaN(timestamp)) return null;
  return new Date(timestamp * 1000);
};

export const getDefaultMessageForStatus = (status, courier, trackingId) => {
  switch (status) {
    case 'Processing': return 'We have received your order and are getting it ready.';
    case 'Packed': return 'Your order is packed and ready for handover to our delivery partner.';
    case 'Shipped': return `Your order has been shipped via ${courier || 'Shiprocket'}. ${trackingId ? `AWB: ${trackingId}` : ''}`;
    case 'Out for Delivery': return 'Our delivery executive is out for delivery. Please keep your phone handy.';
    case 'Delivered': return 'Package delivered successfully. Thank you for shopping with us!';
    case 'Order Cancelled': return 'This order has been cancelled.';
    case 'Returned': return 'Return request processed successfully.';
    default: return `Order status updated to ${status}.`;
  }
};

export const computeAttention = (order) => {
  const reasons = [];
  if (order.paymentStatus === 'PENDING' || order.paymentStatus === 'pending') reasons.push('PAYMENT_PENDING');
  if (order.returnStatus === 'REQUESTED' || order.returnStatus === 'requested') reasons.push('RETURN_REQUESTED');
  
  const hasPendingRefund = (order.refunds && order.refunds.some(r => r.refundStatus === 'pending' || r.refundStatus === 'in_progress'))
    || order.refundStatus === 'PENDING' || order.refundStatus === 'pending';
  if (hasPendingRefund) reasons.push('REFUND_PENDING');

  if (order.status === 'RTO' || order.status === 'RTO Initiated') reasons.push('RTO_RISK');
  
  const twoDaysAgo = new Date();
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
  if (order.fulfillmentStatus === 'PROCESSING' && new Date(order.createdAt) < twoDaysAgo) {
    reasons.push('DELIVERY_DELAY');
  }

  return {
    requiresAttention: reasons.length > 0,
    attentionReasons: reasons
  };
};

export const syncRazorpayRefundStatus = async (order) => {
  const refundsToSync = (order.refunds || []).filter(
    r => r.gatewayRefundId && (r.refundStatus !== 'processed' && r.refundStatus !== 'failed' || (r.refundStatus === 'processed' && !r.completedAt))
  );

  for (const refItem of refundsToSync) {
    try {
      const refund = await razorpay.refunds.fetch(refItem.gatewayRefundId);
      if (refund.status !== refItem.refundStatus || (refund.status === 'processed' && !refItem.completedAt)) {
        let completedAt = refund.status === 'processed' ? (refund.processed_at ? safeDate(refund.processed_at) : new Date()) : null;

        await OrdersRepository.executeTransaction(async (tx) => {
          const { recordRefund } = await import('./refunds.compatibility.js');
          await recordRefund({
            orderId: order.id,
            amount: refund.amount, // in paise
            refundStatus: refund.status, // lowercase legacy
            gatewayRefundId: refund.id,
            refundSpeed: refund.speed_processed || refItem.refundSpeed,
            createdAt: refund.created_at ? safeDate(refund.created_at) : new Date(),
            completedAt: completedAt,
            tx
          });

          if (refund.status === 'processed') {
            await tx.insert(OrdersRepository.orderTimeline).values({
              orderId: order.id,
              status: 'Refunded',
              title: 'Refund Processed',
              description: `Refund of ₹${(refund.amount / 100).toFixed(2)} completed successfully.`,
              timestamp: new Date()
            });
          }
        });
      }
    } catch (syncErr) {
      console.warn("⚠️ Failed to sync with Razorpay:", syncErr.message);
    }
  }

  return order;
};

export const getOrderTimeline = (order) => {
  let finalTimeline = [...(order.timeline || [])];
  const hasPlacedEvent = finalTimeline.some(e => e.status === 'Order Placed');
  if (!hasPlacedEvent) {
    finalTimeline.push({
      status: 'Order Placed',
      title: 'Order Placed',
      description: 'Order placed successfully.',
      timestamp: order.createdAt
    });
  }
  finalTimeline.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  return finalTimeline;
};

export const getOrdersForReportsFormatted = async () => {
  const detailedOrders = await OrdersRepository.getOrdersForReports();

  return detailedOrders.map((order) => ({
    ...order,
    products: order.orderItems.map((item) => ({
      ...item.product,
      ...item.variant,
      price: item.price,
      quantity: item.quantity,
    })),
    orderItems: undefined,
  }));
};

export const updateOrderStatus = async (id, status, message, actorId, expectedVersion = null) => {
  const currentOrder = await OrdersRepository.getOrderById(id);
  if (!currentOrder) throw new Error("Order not found");

  // Safeguard
  if (status === "Shipped" && !currentOrder.shiprocketAwb) {
    throw new Error("Action Blocked: No Shiprocket AWB Found. Please generate a label in the dashboard first.");
  }

  const oldStatus = currentOrder.status;
  let newProgressStep = currentOrder.progressStep;
  if (status === "Processing") newProgressStep = 2;
  if (status === "Shipped") newProgressStep = 3;
  if (status === "Delivered") newProgressStep = 4;
  if (status === "Order Cancelled") newProgressStep = 0;

  const fulfillmentMap = {
    'Processing': FULFILLMENT_STATES.PROCESSING,
    'Packed': FULFILLMENT_STATES.PACKED,
    'Shipped': FULFILLMENT_STATES.SHIPPED,
    'Out for Delivery': FULFILLMENT_STATES.OOD,
    'Delivered': FULFILLMENT_STATES.DELIVERED
  };
  const targetFulfillmentState = fulfillmentMap[status] || currentOrder.fulfillmentStatus;

  if (targetFulfillmentState && currentOrder.fulfillmentStatus && targetFulfillmentState !== currentOrder.fulfillmentStatus) {
    if (!isValidTransition('fulfillmentStatus', currentOrder.fulfillmentStatus, targetFulfillmentState)) {
      throw new Error(`Action Blocked: Cannot transition fulfillment status from ${currentOrder.fulfillmentStatus} to ${targetFulfillmentState}`);
    }
  }

  const updatedOrder = await OrdersRepository.updateOrder(id, {
    status: status,
    progressStep: newProgressStep,
    fulfillmentStatus: targetFulfillmentState,
    updatedAt: new Date()
  }, expectedVersion);

  const timelineTitle = status;
  const timelineDesc = message || getDefaultMessageForStatus(
    status,
    currentOrder.courierName,
    currentOrder.shiprocketAwb
  );

  await OrdersRepository.insertTimelineEvent({
    orderId: id,
    status: status,
    title: timelineTitle,
    description: timelineDesc,
    timestamp: new Date()
  });

  if (actorId && oldStatus !== status) {
    await audit.log({
      actorUserId: actorId,
      actorType: ACTOR_TYPES.ADMIN,
      action: 'ORDER_STATUS_UPDATE',
      resourceType: 'ORDER',
      resourceId: id,
      resourceData: updatedOrder,
      description: `Updated Order #${id} status: ${oldStatus} → ${status}`,
      metadata: { orderId: id, oldStatus, newStatus: status, newFulfillmentStatus: targetFulfillmentState }
    });
  }

  if (status.toLowerCase() === 'delivered') {
    try {
      await processReferralCompletion(updatedOrder.userId);
    } catch (refError) {
      console.error("⚠️ Referral completion failed:", refError);
    }
  }

  let notifyMessage = `Your order #${updatedOrder.id} is now ${status}.`;
  if (status === 'Delivered') notifyMessage = `Your order #${updatedOrder.id} has been delivered!`;
  else if (status === 'Shipped') notifyMessage = `Your order #${updatedOrder.id} has shipped.`;

  await createNotification(
    updatedOrder.userId,
    notifyMessage,
    `/myorder`,
    'order'
  );

  broadcastOrderEvent('ORDER_STATUS_CHANGED', {
    orderId: updatedOrder.id,
    status,
    fulfillmentStatus: targetFulfillmentState,
    version: updatedOrder.version
  }, updatedOrder.userId);

  return updatedOrder;
};

export const cancelOrder = async (id, actorId, expectedVersion = null) => {
  const order = await OrdersRepository.getOrderById(id);
  if (!order) throw new Error("Order not found");

  if (order.status === "Order Cancelled") {
    throw new Error("Order is already cancelled");
  }

  if (order.paymentMode === 'online' && order.transactionId && order.paymentStatus === 'paid') {
    try {
      const payment = await razorpay.payments.fetch(order.transactionId);
      const refundInit = await razorpay.payments.refund(order.transactionId, {
        amount: payment.amount,
        speed: 'optimum',
      });
      const refund = await razorpay.refunds.fetch(refundInit.id);

      const { recordRefund } = await import('./refunds.compatibility.js');
      await recordRefund({
        orderId: id,
        amount: refund.amount, // in paise
        refundStatus: refund.status, // lowercase legacy
        gatewayRefundId: refund.id,
        refundSpeed: refund.speed_processed || 'optimum',
        reason: 'Admin cancelled order',
        createdAt: refund.created_at ? safeDate(refund.created_at) : new Date(),
        completedAt: refund.status === 'processed' ? new Date() : null,
      });
    } catch (payErr) {
      console.error("Admin Auto-Refund Warning:", payErr.message);
    }
  }

  const shiprocketIdToCancel = order.shiprocketOrderId || order.shiprocketShipmentId;

  if (shiprocketIdToCancel) {
    try {
      console.log(`Attempting to cancel Shiprocket order ID: ${shiprocketIdToCancel}`);
      await cancelShiprocketOrder([shiprocketIdToCancel]);

      await OrdersRepository.insertTimelineEvent({
        orderId: id,
        status: 'Order Cancelled',
        title: 'Shiprocket Cancellation Successful',
        description: `Shipment (Shiprocket ID: ${shiprocketIdToCancel}) was successfully cancelled with the courier.`,
        timestamp: new Date()
      });
    } catch (shiprocketError) {
      console.error(`🚨 Shiprocket Cancellation Failed for Order ${id}:`, shiprocketError.message);

      await OrdersRepository.insertTimelineEvent({
        orderId: id,
        status: 'Order Cancelled',
        title: '⚠️ ACTION REQUIRED: Shiprocket Cancel Failed',
        description: `Auto-cancellation failed. You MUST manually cancel this order in the Shiprocket Dashboard to avoid shipping fees! (Shiprocket ID: ${shiprocketIdToCancel}). Reason: ${shiprocketError.message || 'API Error'}`,
        timestamp: new Date()
      });
    }
  }

  await OrdersRepository.updateOrder(id, {
    status: "Order Cancelled",
    paymentStatus: order.paymentMode === 'cod' ? 'cancelled' : 'refunded',
  }, expectedVersion);

  await OrdersRepository.cancelCouponRedemptions(id);

  await OrdersRepository.insertTimelineEvent({
    orderId: id,
    status: 'Order Cancelled',
    title: 'Order Cancelled',
    description: 'Your order was cancelled by support.',
    timestamp: new Date()
  });

  if (actorId) {
    await audit.log({
      actorUserId: actorId,
      actorType: ACTOR_TYPES.ADMIN,
      action: 'ORDER_CANCELLED',
      resourceType: 'ORDER',
      resourceId: id,
      resourceData: order,
      description: `Admin cancelled Order #${id}`,
      metadata: { oldStatus: order.status }
    });
  }

  const orderItems = await OrdersRepository.getOrderItems(id);
  const itemsToInvalidate = [];

  for (const item of orderItems) {
    await OrdersRepository.restoreStock(item.variantId, item.quantity);

    const bundleContents = await OrdersRepository.getBundleContents(item.variantId);
    if (bundleContents.length > 0) {
      for (const content of bundleContents) {
        const qty = item.quantity * content.quantity;
        await OrdersRepository.restoreStock(content.contentVariantId, qty);
      }
    }
    itemsToInvalidate.push(item.productId);
  }

  await createNotification(order.userId, `Your order #${id} was cancelled by support.`, `/myorder`, 'order');
  
  broadcastOrderEvent('ORDER_STATUS_CHANGED', {
    orderId: id,
    status: 'Order Cancelled',
    paymentStatus: order.paymentMode === 'cod' ? 'cancelled' : 'refunded'
  }, order.userId);

  return { order, itemsToInvalidate };
};

export const bulkUpdateStatus = async (orderIds, status, actorId) => {
  const orders = await OrdersRepository.getOrdersByIds(orderIds);
  
  const eligibleIds = [];
  const skipped = [];

  const fulfillmentMap = {
    'Processing': FULFILLMENT_STATES.PROCESSING,
    'Packed': FULFILLMENT_STATES.PACKED,
    'Shipped': FULFILLMENT_STATES.SHIPPED,
    'Out for Delivery': FULFILLMENT_STATES.OOD,
    'Delivered': FULFILLMENT_STATES.DELIVERED
  };
  
  const targetFulfillmentState = fulfillmentMap[status];

  for (const order of orders) {
    if (status === "Shipped" && !order.shiprocketAwb) {
      skipped.push({ id: order.id, reason: 'Missing AWB. Generate labels first.' });
      continue;
    }
    
    if (targetFulfillmentState) {
      if (isValidTransition('fulfillmentStatus', order.fulfillmentStatus || 'PROCESSING', targetFulfillmentState)) {
        eligibleIds.push(order.id);
      } else {
        skipped.push({ id: order.id, reason: `Cannot transition from ${order.fulfillmentStatus} to ${targetFulfillmentState}` });
      }
    } else {
      eligibleIds.push(order.id);
    }
  }

  if (eligibleIds.length === 0) {
    return { updatedOrders: [], eligibleCount: 0, skipped };
  }

  let newProgressStep = 1;
  if (status === "Processing") newProgressStep = 2;
  if (status === "Shipped") newProgressStep = 3;
  if (status === "Delivered") newProgressStep = 4;

  const updatedOrders = await OrdersRepository.bulkUpdateOrdersStatus(eligibleIds, status, newProgressStep, targetFulfillmentState);

  const timelineValues = [];
  
  await Promise.all(updatedOrders.map(async (order) => {
    timelineValues.push({
      orderId: order.id,
      status: status,
      title: status,
      description: getDefaultMessageForStatus(status, order.courierName, order.shiprocketAwb),
      timestamp: new Date()
    });

    if (actorId) {
      await audit.log({
        actorUserId: actorId,
        actorType: ACTOR_TYPES.ADMIN,
        action: 'ORDER_STATUS_BULK_UPDATE',
        resourceType: 'ORDER',
        resourceId: order.id,
        resourceData: order,
        description: `Bulk updated Order #${order.id} to ${status}`,
        metadata: { newStatus: status, newFulfillmentStatus: targetFulfillmentState }
      });
    }

    if (status.toLowerCase() === 'delivered') {
      try {
        await processReferralCompletion(order.userId);
      } catch (err) {
        console.error(`Referral error for ${order.id}:`, err);
      }
    }

    let message = `Your order #${order.id} is now ${status}.`;
    if (status === 'Delivered') message = `Your order #${order.id} has been delivered!`;
    else if (status === 'Shipped') message = `Your order #${order.id} has shipped.`;

    await createNotification(
      order.userId,
      message,
      `/myorder`,
      'order'
    );
  }));

  if (timelineValues.length > 0) {
    await OrdersRepository.bulkInsertTimelineEvents(timelineValues);
  }

  broadcastOrderEvent('ORDER_STATUS_CHANGED', {
    orderIds: eligibleIds,
    status,
    fulfillmentStatus: targetFulfillmentState,
    count: updatedOrders.length
  });

  return updatedOrders;
};

export function estimateOrderWeight(orderItems) {
  let totalWeight = 0;
  for (const item of orderItems) {
    const itemWeight = item.variant?.weight ? parseFloat(item.variant.weight) : 0.5;
    totalWeight += itemWeight * item.quantity;
  }
  return totalWeight > 0 ? parseFloat(totalWeight.toFixed(2)) : 0.5;
}

export const getShipPreview = async (orderIds, pickupPincode) => {
  const orders = await OrdersRepository.getOrdersByIds(orderIds);
  const results = [];
  let totalEstimate = 0;

  for (const order of orders) {
    if (!order.shiprocketShipmentId) {
      results.push({ orderId: order.id, error: "Not yet synced to Shiprocket — no shipment ID." });
      continue;
    }
    if (order.shiprocketAwb) {
      results.push({ orderId: order.id, error: "Already has an AWB assigned." });
      continue;
    }
    try {
      const weight = estimateOrderWeight(order.orderItems);
      const svc = await getServiceability({
        pickup_postcode: pickupPincode,
        delivery_postcode: order.address.postalCode,
        weight,
        cod: order.paymentMode === 'cod' ? 1 : 0,
      });
      const couriers = svc?.data?.available_courier_companies || [];
      const cheapest = couriers.length
        ? couriers.reduce((min, c) => (c.rate < min.rate ? c : min), couriers[0])
        : null;

      if (!cheapest) {
        results.push({ orderId: order.id, error: "No serviceable courier found for this pincode." });
        continue;
      }

      totalEstimate += cheapest.rate;
      results.push({
        orderId: order.id,
        courierName: cheapest.courier_name,
        courierId: cheapest.courier_company_id,
        estimatedRate: cheapest.rate,
        estimatedDays: cheapest.estimated_delivery_days,
      });
    } catch (err) {
      results.push({ orderId: order.id, error: err.message || "Serviceability check failed." });
    }
  }
  return { results, totalEstimate };
};

export const shipNow = async (shipRequests) => {
  const orderIds = shipRequests.map(r => r.orderId);
  const orders = await OrdersRepository.getOrdersByIds(orderIds);
  const orderMap = new Map(orders.map(o => [o.id, o]));

  const results = [];
  const timelineValues = [];

  for (const req_ of shipRequests) {
    const order = orderMap.get(req_.orderId);
    if (!order) {
      results.push({ orderId: req_.orderId, success: false, error: "Order not found." });
      continue;
    }
    if (!order.shiprocketShipmentId) {
      results.push({ orderId: order.id, success: false, error: "No Shiprocket shipment ID." });
      continue;
    }
    if (order.shiprocketAwb) {
      results.push({ orderId: order.id, success: false, error: "Already shipped." });
      continue;
    }

    try {
      const srResponse = await assignAwb({
        shipment_id: order.shiprocketShipmentId,
        courier_id: req_.courierId || null,
      });
      const awbData = srResponse?.response?.data;
      if (!awbData?.awb_code) {
        throw new Error(srResponse?.message || "Shiprocket did not return an AWB code.");
      }

      await OrdersRepository.updateOrder(order.id, {
        shiprocketAwb: String(awbData.awb_code),
        courierName: awbData.courier_name || null,
        status: 'Packed',
        progressStep: 2
      });

      timelineValues.push({
        orderId: order.id,
        status: 'Packed',
        title: 'Packed',
        description: `Shipped via ${awbData.courier_name || 'courier'}. AWB: ${awbData.awb_code}`,
        timestamp: new Date(),
      });

      results.push({ orderId: order.id, success: true, awb: awbData.awb_code, courierName: awbData.courier_name });
    } catch (err) {
      results.push({ orderId: order.id, success: false, error: err.message || "AWB assignment failed." });
    }
  }

  if (timelineValues.length > 0) {
    await OrdersRepository.bulkInsertTimelineEvents(timelineValues);
  }

  broadcastOrderEvent('SHIPMENT_UPDATED', {
    results
  });

  return { results, timelineValues };
};

export const initiateReturn = async (id, requester) => {
  const order = await OrdersRepository.getOrderByIdWithDetails(id);
  if (!order) throw new Error("Order not found");

  const isAuthorized = order.userId === requester.id || requester.role === 'admin' || !!requester.adminRole || requester.permissions?.includes('orders.return');
  if (!isAuthorized) {
    throw new Error("Forbidden: You cannot initiate a return for this order.");
  }

  const lockedOrder = await OrdersRepository.lockOrderForReturn(id);
  if (!lockedOrder) {
    throw new Error("Order is not delivered or a return is already in progress.");
  }

  try {
    const formattedItems = order.orderItems.map(item => ({
      name: item.product.name,
      sku: item.variant?.sku || `SKU-${item.variantId.substring(0, 8)}`,
      units: item.quantity,
      selling_price: item.price,
    }));

    const returnPayload = {
      order_id: `RET-${order.id}`,
      order_date: new Date().toISOString().split('T')[0],

      pickup_customer_name: order.user.name,
      pickup_address: order.address.address,
      pickup_city: order.address.city,
      pickup_state: order.address.state,
      pickup_country: order.address.country || "India",
      pickup_pincode: order.address.postalCode,
      pickup_email: order.user.email,
      pickup_phone: order.address.phone || order.user.phone,

      shipping_customer_name: process.env.RETURN_CUSTOMER_NAME,
      shipping_phone: process.env.RETURN_PHONE,
      shipping_address: process.env.RETURN_ADDRESS,
      shipping_city: process.env.RETURN_CITY,
      shipping_state: process.env.RETURN_STATE,
      shipping_pincode: process.env.RETURN_PINCODE,
      shipping_country: process.env.RETURN_COUNTRY,

      order_items: formattedItems,
      payment_method: "Prepaid",
      sub_total: order.totalAmount,
      length: 10, breadth: 10, height: 10, weight: 0.5 
    };

    const shiprocketRes = await createReturnOrder(returnPayload);

    await OrdersRepository.updateOrder(id, {
      status: "Return Initiated"
    });

    await OrdersRepository.insertTimelineEvent({
      orderId: order.id,
      status: 'Return Initiated',
      title: 'Return Initiated',
      description: `Reverse pickup generated. AWB: ${shiprocketRes.awb_code || 'Pending'}`,
      timestamp: new Date()
    });

    broadcastOrderEvent('RETURN_UPDATED', {
      orderId: order.id,
      status: 'Return Initiated'
    }, order.userId);

    return { order, shiprocketRes };

  } catch (shiprocketError) {
    await OrdersRepository.updateOrder(id, {
      status: "Delivered"
    });
    throw shiprocketError;
  }
};

export const addOrderNote = async (orderId, adminId, noteContent) => {
  if (!noteContent) throw new Error("Note content is required");
  
  const note = await OrdersRepository.insertOrderNote({
    orderId,
    adminId,
    note: noteContent,
    isInternal: true
  });
  
  await audit.log({
    actorUserId: adminId,
    actorType: ACTOR_TYPES.ADMIN,
    action: 'ORDER_NOTE_ADDED',
    resourceType: 'ORDER',
    resourceId: orderId,
    description: `Added internal note to Order #${orderId}`,
    metadata: { noteId: note.id }
  });

  return note;
};
