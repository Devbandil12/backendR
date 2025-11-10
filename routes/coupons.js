// routes/coupons.js
import express from "express";
import { db } from "../configs/index.js";
import { couponsTable, ordersTable } from "../configs/schema.js";
// 🟢 FIX: Added missing drizzle-orm functions
import { eq, and, isNull, gte, lte, or, inArray } from "drizzle-orm"; 

import { cache } from "../cacheMiddleware.js";
import { invalidateMultiple } from "../invalidateHelpers.js";
import { makeAllCouponsKey, makeCouponValidationKey, makeAvailableCouponsKey } from "../cacheKeys.js";

const router = express.Router();

/* -------------------------------------------------------
   GET /api/coupons — list all coupons (admin)
   (Unchanged)
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
   🟢 POST /api/coupons — (MODIFIED)
   Accepts all new fields for automatic promotions
-------------------------------------------------------- */
router.post("/", async (req, res) => {
  try {
    const { body } = req;
    // 🟢 NEW: Full payload from the admin panel
    const payload = {
      code: body.code,
      description: body.description,
      discountType: body.discountType,
      discountValue: body.discountValue,
      minOrderValue: body.minOrderValue,
      minItemCount: body.minItemCount,
      maxDiscountAmount: body.maxDiscountAmount, // 🟢 Added
      validFrom: body.validFrom ? new Date(body.validFrom) : null,
      validUntil: body.validUntil ? new Date(body.validUntil) : null,
      firstOrderOnly: body.firstOrderOnly,
      maxUsagePerUser: body.maxUsagePerUser,
      isAutomatic: body.isAutomatic,
      cond_requiredCategory: body.cond_requiredCategory,
      cond_requiredSize: body.cond_requiredSize, // 🟢 Added
      action_targetSize: body.action_targetSize,
      action_targetMaxPrice: body.action_targetMaxPrice,
      action_buyX: body.action_buyX,
      action_getY: body.action_getY,
    };

    const [inserted] = await db.insert(couponsTable).values(payload).returning();

    // Invalidate all coupon caches
    await invalidateMultiple([
      { key: makeAllCouponsKey() },
      { key: "coupons:available", prefix: true },
      { key: "coupons:validate", prefix: true },
      { key: "coupons:auto-offers" }, // 🟢 Invalidate new cache
      { key: "promos:latest-public" }
    ]);

    res.status(201).json(inserted);
  } catch (err) {
    console.error("❌ Failed to insert coupon:", err);
    res.status(400).json({ error: err.message });
  }
});

/* -------------------------------------------------------
   GET /api/coupons/validate — (MODIFIED)
   This route is only for MANUAL coupons.
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

      // FIX: Do not allow manual entry of automatic coupons
      if (coupon.isAutomatic) {
        return res.status(400).json({ message: "This offer is applied automatically." });
      }

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
   GET /api/coupons/available — (MODIFIED)
   This route only shows MANUAL coupons to the user.
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
        // FIX: Don't show automatic offers in this list
        if (coupon.isAutomatic) return false;

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
   PUT /api/coupons/:id — (MODIFIED)
   Accepts all new fields for automatic promotions
-------------------------------------------------------- */
router.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  try {
    const { body } = req;
    const payload = {
      code: body.code,
      description: body.description,
      discountType: body.discountType,
      discountValue: body.discountValue,
      minOrderValue: body.minOrderValue,
      minItemCount: body.minItemCount,
      maxDiscountAmount: body.maxDiscountAmount, // 🟢 Added
      validFrom: body.validFrom ? new Date(body.validFrom) : null,
      validUntil: body.validUntil ? new Date(body.validUntil) : null,
      firstOrderOnly: body.firstOrderOnly,
      maxUsagePerUser: body.maxUsagePerUser,
      isAutomatic: body.isAutomatic,
      cond_requiredCategory: body.cond_requiredCategory,
      cond_requiredSize: body.cond_requiredSize, // 🟢 Added
      action_targetSize: body.action_targetSize,
      action_targetMaxPrice: body.action_targetMaxPrice,
      action_buyX: body.action_buyX,
      action_getY: body.action_getY,
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
      { key: "coupons:auto-offers" },
      { key: "promos:latest-public" }
    ]);

    res.json(updated);
  } catch (err) {
    console.error("❌ Failed to update coupon:", err);
    res.status(400).json({ error: err.message });
  }
});

/* -------------------------------------------------------
   DELETE /api/coupons/:id — (MODIFIED)
-------------------------------------------------------- */
router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  try {
    await db.delete(couponsTable).where(eq(couponsTable.id, id));

    await invalidateMultiple([
      { key: makeAllCouponsKey() },
      { key: "coupons:available", prefix: true },
      { key: "coupons:validate", prefix: true },
      { key: "coupons:auto-offers" },
      { key: "promos:latest-public" }
    ]);

    res.sendStatus(204);
  } catch (err) {
    console.error("❌ Failed to delete coupon:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* -------------------------------------------------------
   🟢 NEW: GET /api/coupons/automatic-offers
   Fetches all *active* automatic offers with their full rule data
-------------------------------------------------------- */
router.get("/automatic-offers", cache(() => "coupons:auto-offers", 3600), async (req, res) => {
  try {
    const now = new Date();
    // 🟢 FIX: Change select() to get all fields
    const allAutoOffers = await db
      .select() // This now selects all columns
      .from(couponsTable)
      .where(
        and(
          eq(couponsTable.isAutomatic, true),
          or(isNull(couponsTable.validFrom), lte(couponsTable.validFrom, now)),
          or(isNull(couponsTable.validUntil), gte(couponsTable.validUntil, now))
        )
      );

    res.json(allAutoOffers);
  } catch (err) {
    console.error("❌ Failed to load automatic offers:", err);
    res.status(500).json({ error: "Server error" });
  }
});


export default router;