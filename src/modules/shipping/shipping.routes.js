import express from 'express';
import crypto from 'crypto';
import * as ShippingController from './shipping.controller.js';
import { safeCompare } from '../../utils/safeCompare.js';

const router = express.Router();

const verifyShiprocketWebhook = (req, res, next) => {
  try {
    const signature = req.headers['x-shiprocket-signature'];
    
    if (!signature) {
      console.warn("⚠️ Shiprocket Webhook missing signature header");
      return res.status(401).json({ error: "Missing signature" });
    }

    const secret = process.env.SHIPROCKET_PASSWORD;
    
    if (!secret) {
        console.error("❌ SHIPROCKET_PASSWORD missing in .env. Cannot verify webhook.");
        return res.status(500).json({ error: "Server misconfiguration" });
    }

    if (!Buffer.isBuffer(req.body)) {
      console.error("❌ Webhook body is not a Buffer. Make sure express.raw() is used.");
      return res.status(400).json({ error: "Invalid body format" });
    }

    const generatedSignature = crypto
      .createHmac('sha256', secret)
      .update(req.body)
      .digest('base64');

    if (!safeCompare(signature, generatedSignature)) {
      console.warn("⛔ Invalid Shiprocket Webhook Signature. Potential attack.");
      return res.status(403).json({ error: "Invalid signature" });
    }

    next();
  } catch (error) {
    console.error("Webhook Verification Error:", error);
    return res.status(403).json({ error: "Verification failed" });
  }
};

router.get('/status', ShippingController.getStatus);
router.post('/orders', ShippingController.createOrderManual);
router.post('/webhook', verifyShiprocketWebhook, ShippingController.handleWebhook);

import { requireAuth, verifyAdmin } from '../../middleware/auth.js';
router.get('/rules', requireAuth, verifyAdmin, ShippingController.getShippingRules);
router.put('/rules', requireAuth, verifyAdmin, ShippingController.updateShippingRules);

export default router;
