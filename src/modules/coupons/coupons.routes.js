import express from "express";
import * as CouponsController from "./coupons.controller.js";
import { cache } from "../../infrastructure/cache/cache.service.js";
import { makeAllCouponsKey, makeAvailableCouponsKey } from "../../infrastructure/cache/cache.keys.js";
import { requireAuth, verifyAdmin } from "../../middleware/auth.js";
import { rateLimit } from "../../middleware/rate-limit.js";

const router = express.Router();

const couponValidateLimiter = rateLimit({
  windowSeconds: 60,
  max: 20,
  keyPrefix: 'rl:coupon-validate',
  message: 'Too many coupon checks. Please wait a moment and try again.',
});

/* -------------------------------------------------------
   🔒 ADMIN ROUTES
-------------------------------------------------------- */
router.get("/", requireAuth, verifyAdmin, cache(() => makeAllCouponsKey(), 3600), CouponsController.getAllCoupons);
router.post("/", requireAuth, verifyAdmin, CouponsController.createCoupon);
router.put("/:id", requireAuth, verifyAdmin, CouponsController.updateCoupon);
router.delete("/:id", requireAuth, verifyAdmin, CouponsController.deleteCoupon);

/* -------------------------------------------------------
   🟢 PUBLIC/USER ROUTES
-------------------------------------------------------- */
router.get("/validate", couponValidateLimiter, CouponsController.validateCoupon);
router.get("/available", cache((req) => makeAvailableCouponsKey(req.query.userId || ""), 300), CouponsController.getAvailableCoupons);
router.get("/automatic-offers", cache(() => "coupons:auto-offers", 3600), CouponsController.getAutomaticOffers);

export default router;
