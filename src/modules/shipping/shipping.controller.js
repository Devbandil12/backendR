import * as ShippingService from './shipping.service.js';
import { createOrder } from '../../infrastructure/shipping/providers/shiprocket.js';
import { invalidateMultiple } from '../../infrastructure/cache/cache.invalidate.js';
import { makeAllOrdersKey, makeOrderKey, makeUserOrdersKey, makeAllProductsKey, makeProductKey } from '../../infrastructure/cache/cache.keys.js';

export const getStatus = (req, res) => {
  const configured =
    !!process.env.SHIPROCKET_EMAIL &&
    !!process.env.SHIPROCKET_PASSWORD;

  res.json({
    shiprocketConfigured: configured,
    baseUrl: process.env.SHIPROCKET_BASE_URL || 'https://apiv2.shiprocket.in',
  });
};

export const createOrderManual = async (req, res, next) => {
  try {
    const payload = req.body;
    const response = await createOrder(payload);
    res.json(response);
  } catch (err) {
    next(err);
  }
};

export const handleWebhook = async (req, res) => {
  try {
    const payload = JSON.parse(req.body.toString('utf8'));
    
    const result = await ShippingService.processWebhookEvent(payload);

    if (!result.orderFound) {
      console.log(`⚠️ Webhook received for unknown Shiprocket Order/Shipment/AWB: ${result.shiprocketOrderId} / ${result.shiprocketShipmentId} / ${result.shiprocketAwb}`);
      return res.status(200).json({ message: "Order not found" });
    }

    const { order, mappedStatus, rawStatus, productIdsToInvalidate } = result;

    const cacheKeysToInvalidate = [
      { key: makeAllOrdersKey() },
      { key: makeOrderKey(order.id) },
      { key: makeUserOrdersKey(order.userId) },
    ];

    if (productIdsToInvalidate && productIdsToInvalidate.length > 0) {
      cacheKeysToInvalidate.push({ key: makeAllProductsKey() });
      for (const pid of productIdsToInvalidate) {
        cacheKeysToInvalidate.push({ key: makeProductKey(pid) });
      }
    }

    await invalidateMultiple(cacheKeysToInvalidate);

    console.log(`✅ Webhook processed for Order #${order.id}: ${rawStatus} -> ${mappedStatus}`);
    res.json({ success: true });

  } catch (err) {
    if (err.message === 'Payload missing order_id, shipment_id, and awb') {
      console.error('⚠️ Webhook dropped: Payload missing order_id, shipment_id, and awb');
      return res.status(200).json({ message: "Invalid payload, missing IDs" });
    }
    console.error('❌ Shiprocket Webhook Error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

import { shippingRulesTable } from '../../db/schema/index.js';
import { db } from '../../db/client.js';

export const getShippingRules = async (req, res) => {
  try {
    let rules = await db.query.shippingRulesTable.findFirst();
    if (!rules) {
      rules = { freeShippingThreshold: 999, flatShippingRate: 50 };
      await db.insert(shippingRulesTable).values({ id: 1, ...rules }).onConflictDoNothing();
    }
    res.json(rules);
  } catch (error) {
    console.error("Error fetching shipping rules:", error);
    res.status(500).json({ error: "Failed to fetch shipping rules" });
  }
};

export const updateShippingRules = async (req, res) => {
  try {
    const { freeShippingThreshold, flatShippingRate } = req.body;
    await db.insert(shippingRulesTable)
      .values({ id: 1, freeShippingThreshold, flatShippingRate })
      .onConflictDoUpdate({
        target: shippingRulesTable.id,
        set: { freeShippingThreshold, flatShippingRate }
      });
    res.json({ success: true, freeShippingThreshold, flatShippingRate });
  } catch (error) {
    console.error("Error updating shipping rules:", error);
    res.status(500).json({ error: "Failed to update shipping rules" });
  }
};
