// ✅ file: routes/shiprocket.js

import express from 'express';
import crypto from 'crypto'; // Required for security verification
import Razorpay from 'razorpay'; // ✅ ADDED: Required for auto-refunds
import {
  createOrder,
  cancelOrder,
  trackByAwb,
  trackByShipment,
  getServiceability,
  getPickupLocations,
} from '../services/shiprocket.service.js';
import { db } from '../configs/index.js';
import { ordersTable, orderTimeline } from '../configs/schema.js';
import { eq, or } from 'drizzle-orm'; // ✅ FIXED: Imported 'or' for the webhook lookup
import { createNotification } from '../helpers/notificationManager.js';
import { invalidateMultiple } from '../invalidateHelpers.js';
import { makeAllOrdersKey, makeOrderKey, makeUserOrdersKey } from '../cacheKeys.js';

const router = express.Router();

// ✅ ADDED: Initialize Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_ID_KEY,
  key_secret: process.env.RAZORPAY_SECRET_KEY,
});

/**
 * 🔒 SECURITY MIDDLEWARE
 * Verifies that the webhook request actually came from Shiprocket.
 * It uses your SHIPROCKET_PASSWORD as the secret key to validate the signature.
 */
const verifyShiprocketWebhook = (req, res, next) => {
  try {
    const signature = req.headers['x-shiprocket-signature'];
    
    // 1. Check if signature header exists
    if (!signature) {
      console.warn("⚠️ Shiprocket Webhook missing signature header");
      return res.status(401).json({ error: "Missing signature" });
    }

    const secret = process.env.SHIPROCKET_PASSWORD;
    
    // 2. Ensure environment variable is set
    if (!secret) {
        console.error("❌ SHIPROCKET_PASSWORD missing in .env. Cannot verify webhook.");
        return res.status(500).json({ error: "Server misconfiguration" });
    }

    // 3. Generate HMAC-SHA256 hash of the request body
    // Note: req.body must be the raw JSON object. Express parses this by default.
    const generatedSignature = crypto
      .createHmac('sha256', secret)
      .update(JSON.stringify(req.body))
      .digest('base64');

    // 4. Compare signatures
    if (signature !== generatedSignature) {
      console.warn("⛔ Invalid Shiprocket Webhook Signature. Potential attack.");
      return res.status(403).json({ error: "Invalid signature" });
    }

    next();
  } catch (error) {
    console.error("Webhook Verification Error:", error);
    return res.status(403).json({ error: "Verification failed" });
  }
};

// ------------------------------------------------------------------
// ROUTES
// ------------------------------------------------------------------

// 1. Health / Config Check
router.get('/status', (req, res) => {
  const configured =
    !!process.env.SHIPROCKET_EMAIL &&
    !!process.env.SHIPROCKET_PASSWORD;

  res.json({
    shiprocketConfigured: configured,
    baseUrl: process.env.SHIPROCKET_BASE_URL || 'https://apiv2.shiprocket.in',
  });
});

// 2. Manual Order Creation (For Debugging/Testing)
router.post('/orders', async (req, res, next) => {
  try {
    const payload = req.body;
    const response = await createOrder(payload);
    res.json(response);
  } catch (err) {
    next(err);
  }
});

/**
 * 3. MAIN WEBHOOK HANDLER
 * Receives updates from Shiprocket when order status changes.
 */
router.post('/webhook', verifyShiprocketWebhook, async (req, res) => {
  try {
    const payload = req.body;
    
    // Log payload for debugging (optional, remove in production if too noisy)
    // console.log("📨 Shiprocket Webhook:", JSON.stringify(payload, null, 2));

    // Shiprocket sends 'awb' (sometimes 'awb_code') and 'current_status'
    const shiprocketAwb = payload.awb || payload.awb_code; 
    const rawStatus = payload.current_status; 

    // Extract other useful details
    const { 
        courier_name: courierName, 
        shipment_id: shiprocketShipmentId, 
        order_id: shiprocketOrderId, 
        etd: expectedDelivery 
    } = payload;

    // Guard against missing IDs that we need for the lookup
    if (!shiprocketOrderId && !shiprocketShipmentId && !shiprocketAwb) {
       console.error('⚠️ Webhook dropped: Payload missing order_id, shipment_id, and awb');
       return res.status(200).json({ message: "Invalid payload, missing IDs" });
    }

    // --- MAP SHIPROCKET STATUS TO INTERNAL STATUS ---
    let mappedStatus = null;
    let shouldTriggerRefund = false; // Flag for auto-refund
    
    switch (rawStatus) {
        case 'AWB ASSIGNED':
        case 'READY TO SHIP':
        case 'MANIFESTED':
            mappedStatus = 'Packed';
            break;
        case 'PICKED UP':
        case 'IN TRANSIT':
        case 'SHIPPED':
            mappedStatus = 'Shipped';
            break;
        case 'OUT FOR DELIVERY':
            mappedStatus = 'Out for Delivery';
            break;
        case 'DELIVERED':
            mappedStatus = 'Delivered';
            break;
        case 'CANCELLED':
        case 'NA': // Not Applicable / Cancelled before ship
            mappedStatus = 'Order Cancelled';
            break;
        case 'RTO INITIATED':
        case 'RTO IN TRANSIT':
            mappedStatus = 'RTO Initiated';
            break;
        case 'RTO DELIVERED':
        case 'RETURN DELIVERED': 
            mappedStatus = 'Returned';
            shouldTriggerRefund = true; // Trigger refund upon successful return
            break;
        default:
            // For unknown statuses, we generally don't change the main status 
            // unless we want to track everything.
            mappedStatus = null; 
    }

    // --- DATABASE UPDATE ---

    // ✅ FIXED: CHANGE 1 - Dynamic Lookup
    // Try matching on AWB first (for subsequent events), then fall back to Order ID or Shipment ID
    const searchConditions = [];
    if (shiprocketAwb) searchConditions.push(eq(ordersTable.shiprocketAwb, String(shiprocketAwb)));
    if (shiprocketOrderId) searchConditions.push(eq(ordersTable.shiprocketOrderId, String(shiprocketOrderId)));
    if (shiprocketShipmentId) searchConditions.push(eq(ordersTable.shiprocketShipmentId, String(shiprocketShipmentId)));

    const [order] = await db
      .select()
      .from(ordersTable)
      .where(or(...searchConditions));

    if (!order) {
      console.log(`⚠️ Webhook received for unknown Shiprocket Order/Shipment/AWB: ${shiprocketOrderId} / ${shiprocketShipmentId} / ${shiprocketAwb}`);
      // Return 200 to Shiprocket so they don't keep retrying
      return res.status(200).json({ message: "Order not found" });
    }

    // 2. Transaction: Update Order & Add Timeline
    await db.transaction(async (tx) => {
      // Update Main Order Details
      await tx.update(ordersTable)
        .set({
          // ✅ FIXED: CHANGE 2 - Explicitly write AWB to database
          shiprocketAwb: shiprocketAwb || order.shiprocketAwb,
          
          ...(mappedStatus ? { status: mappedStatus } : {}),
          courierName: courierName || order.courierName,
          shiprocketOrderId: shiprocketOrderId ? String(shiprocketOrderId) : order.shiprocketOrderId,
          shiprocketShipmentId: shiprocketShipmentId ? String(shiprocketShipmentId) : order.shiprocketShipmentId,
          expectedDeliveryDate: expectedDelivery ? new Date(expectedDelivery) : order.expectedDeliveryDate,
          updatedAt: new Date(),
          
          // Map progress step for UI bars
          progressStep: 
            mappedStatus === 'Processing' ? 2 :
            mappedStatus === 'Packed' ? 2 : // Visual preference
            mappedStatus === 'Shipped' ? 3 :
            mappedStatus === 'Delivered' ? 4 :
            mappedStatus === 'Order Cancelled' ? 0 : 
            order.progressStep
        })
        .where(eq(ordersTable.id, order.id));

      // Insert Timeline Entry (Always record the activity)
      // Even if status didn't change (e.g. "In Transit" -> "In Transit"), record the location/scan
      const activityDescription = payload.scans?.[0]?.activity || payload.remark || rawStatus;
      
      await tx.insert(orderTimeline).values({
        orderId: order.id,
        status: mappedStatus || order.status, // Use existing status if mapping is null
        title: mappedStatus || rawStatus, // "Shipped" or "IN TRANSIT"
        description: `${activityDescription} (Location: ${payload.scans?.[0]?.location || 'N/A'})`,
        timestamp: new Date(),
      });
    });

    // 3. Process Automatic Refunds for Returns / RTOs
    if (shouldTriggerRefund && order.paymentMode === 'online' && order.paymentStatus === 'paid' && order.transactionId) {
      try {
        console.log(`Processing automatic refund for Order ${order.id}...`);
        
        const payment = await razorpay.payments.fetch(order.transactionId);
        const refundInit = await razorpay.payments.refund(order.transactionId, {
          amount: payment.amount,
          speed: 'optimum',
        });
        
        await db.update(ordersTable).set({
          paymentStatus: 'refunded',
          refund_id: refundInit.id,
          refund_amount: refundInit.amount,
          refund_status: refundInit.status,
          updatedAt: new Date()
        }).where(eq(ordersTable.id, order.id));

        await db.insert(orderTimeline).values({
          orderId: order.id,
          status: 'Refunded',
          title: 'Refund Initiated',
          description: `Your refund of ₹${(refundInit.amount / 100).toFixed(2)} has been initiated.`,
          timestamp: new Date()
        });

      } catch (refundError) {
        console.error(`⚠️ Webhook Auto-Refund Failed for Order ${order.id}:`, refundError.message);
      }
    }

    // 4. Send User Notification (Only for major status changes)
    if (mappedStatus && mappedStatus !== order.status) {
      let notifyMessage = `Your order #${order.id} status is now ${mappedStatus}.`;
      if (mappedStatus === 'Out for Delivery') notifyMessage = `Out for delivery! Your order #${order.id} will reach you soon.`;
      if (mappedStatus === 'Delivered') notifyMessage = `Order #${order.id} Delivered. Enjoy your purchase!`;
      if (mappedStatus === 'Returned') notifyMessage = `Order #${order.id} has been returned successfully to our warehouse.`; // Added Return notification

      await createNotification(
          order.userId, 
          notifyMessage, 
          `/myorder`, 
          'order'
      );
    }

    // 5. Invalidate Cache
    await invalidateMultiple([
      { key: makeAllOrdersKey() },
      { key: makeOrderKey(order.id) },
      { key: makeUserOrdersKey(order.userId) },
    ]);

    console.log(`✅ Webhook processed for Order #${order.id}: ${rawStatus} -> ${mappedStatus}`);
    res.json({ success: true });

  } catch (err) {
    console.error('❌ Shiprocket Webhook Error:', err);
    // Return 500 so Shiprocket knows to retry later if it was a server error
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;