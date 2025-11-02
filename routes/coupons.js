// routes/coupons.js
import express from "express";
import { db } from "../configs/index.js";
import { couponsTable, ordersTable } from "../configs/schema.js";
import { eq, and } from "drizzle-orm";

import { cache } from "../cacheMiddleware.js";
import { invalidateMultiple } from "../invalidateHelpers.js";
import { makeAllCouponsKey, makeCouponValidationKey, makeAvailableCouponsKey } from "../cacheKeys.js";

const router = express.Router();

/* -------------------------------------------------------
   🟢 GET /api/coupons — list all coupons (admin)
   Cached for 1 hour
-------------------------------------------------------- */
router.get("/", cache(() => makeAllCouponsKey(), 3600), async (req, res) => {
  try {
    const all = await db.select().from(couponsTable);
    res.json(all);
  } catch (err) {
    console.error("❌ Failed to load coupons:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* -------------------------------------------------------
   🟢 POST /api/coupons — create a new coupon
   Invalidates all related caches
-------------------------------------------------------- */
router.post("/", async (req, res) => {
  try {
    const payload = {
      ...req.body,
      validFrom: req.body.validFrom ? new Date(req.body.validFrom) : null,
      validUntil: req.body.validUntil ? new Date(req.body.validUntil) : null,
    };

    const [inserted] = await db.insert(couponsTable).values(payload).returning();

    // Invalidate all coupon caches
    await invalidateMultiple([
      { key: makeAllCouponsKey() },
      { key: "coupons:available", prefix: true },
      { key: "coupons:validate", prefix: true },
    ]);

    res.status(201).json(inserted);
  } catch (err) {
    console.error("❌ Failed to insert coupon:", err);
    res.status(400).json({ error: err.message });
  }
});

/* -------------------------------------------------------
   🟢 GET /api/coupons/validate
   Validate coupon by code + userId
   Cached for 60s per (code,userId)
-------------------------------------------------------- */
router.get(
  "/validate",
  cache((req) => makeCouponValidationKey(req.query.code, req.query.userId), 60),
  async (req, res) => {
    const { code, userId } = req.query;

    if (!code || !userId) {
      return res
        .status(400)
        .json({ error: "Coupon code and userId are required" });
    }

    try {
      const [coupon] = await db
        .select()
        .from(couponsTable)
        .where(eq(couponsTable.code, code));

      if (!coupon) return res.status(404).json({ message: "Coupon not found" });

      const now = new Date();
      if (coupon.validFrom && now < new Date(coupon.validFrom)) {
        return res.status(400).json({ message: "Coupon not yet valid" });
      }
      if (coupon.validUntil && now > new Date(coupon.validUntil)) {
        return res.status(400).json({ message: "Coupon expired" });
      }

      if (coupon.firstOrderOnly) {
        const userOrders = await db
          .select()
          .from(ordersTable)
          .where(eq(ordersTable.userId, userId));
        if (userOrders.length > 0) {
          return res
            .status(400)
            .json({ message: "Coupon only valid for first order" });
        }
      }

      const usedCouponOrders = await db
        .select()
        .from(ordersTable)
        .where(
          and(eq(ordersTable.userId, userId), eq(ordersTable.couponCode, code))
        );

      if (
        coupon.maxUsagePerUser !== null &&
        usedCouponOrders.length >= coupon.maxUsagePerUser
      ) {
        return res.status(400).json({ message: "Coupon usage limit reached" });
      }

      res.json(coupon);
    } catch (err) {
      console.error("❌ Coupon validation failed:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

/* -------------------------------------------------------
   🟢 GET /api/coupons/available?userId=123
   Cached per user for 5 minutes
-------------------------------------------------------- */
router.get(
  "/available",
  cache((req) => makeAvailableCouponsKey(req.query.userId || ""), 300),
  async (req, res) => {
    const userId = req.query.userId;
    if (!userId || typeof userId !== "string") {
      return res.status(400).json({ error: "Valid userId is required" });
    }

    try {
      const allCoupons = await db.select().from(couponsTable);
      const usages = await db
        .select()
        .from(ordersTable)
        .where(eq(ordersTable.userId, userId));

      const usageMap = {};
      usages.forEach((order) => {
        if (order.couponCode) {
          usageMap[order.couponCode] =
            (usageMap[order.couponCode] || 0) + 1;
        }
      });

      const now = new Date();
      const availableCoupons = allCoupons.filter((coupon) => {
        const usageCount = usageMap[coupon.code] || 0;
        if (
          coupon.maxUsagePerUser !== null &&
          usageCount >= coupon.maxUsagePerUser
        )
          return false;
        if (coupon.validFrom && now < new Date(coupon.validFrom)) return false;
        if (coupon.validUntil && now > new Date(coupon.validUntil)) return false;
        if (coupon.firstOrderOnly && usages.length > 0) return false;
        return true;
      });

      res.json(availableCoupons);
    } catch (err) {
      console.error("❌ Failed to load available coupons:", err);
      res.status(500).json({ error: "Server error" });
    }
  }
);

/* -------------------------------------------------------
   🟢 PUT /api/coupons/:id — update coupon
   Invalidates all related caches
-------------------------------------------------------- */
router.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  try {
    const payload = {
      ...req.body,
      validFrom: req.body.validFrom ? new Date(req.body.validFrom) : null,
      validUntil: req.body.validUntil ? new Date(req.body.validUntil) : null,
    };

    const [updated] = await db
      .update(couponsTable)
      .set(payload)
      .where(eq(couponsTable.id, id))
      .returning();

    await invalidateMultiple([
      { key: makeAllCouponsKey() },
      { key: "coupons:available", prefix: true },
      { key: "coupons:validate", prefix: true },
    ]);

    res.json(updated);
  } catch (err) {
    console.error("❌ Failed to update coupon:", err);
    res.status(400).json({ error: err.message });
  }
});

/* -------------------------------------------------------
   🟢 DELETE /api/coupons/:id — delete coupon
   Invalidates all related caches
-------------------------------------------------------- */
router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  try {
    await db.delete(couponsTable).where(eq(couponsTable.id, id));

    await invalidateMultiple([
      { key: makeAllCouponsKey() },
      { key: "coupons:available", prefix: true },
      { key: "coupons:validate", prefix: true },
    ]);

    res.sendStatus(204);
  } catch (err) {
    console.error("❌ Failed to delete coupon:", err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
