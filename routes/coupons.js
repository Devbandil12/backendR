import express from "express";
import { db } from "../configs/index.js";
import { couponsTable, ordersTable } from "../configs/schema.js";
import { eq, and } from "drizzle-orm";

const router = express.Router();

// GET /api/coupons — list all
router.get("/", async (req, res) => {
  try {
    const all = await db.select().from(couponsTable);
    res.json(all);
  } catch (err) {
    console.error("Failed to load coupons:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/coupons — create new
router.post("/", async (req, res) => {
  try {
    const [inserted] = await db
      .insert(couponsTable)
      .values(req.body)
      .returning();
    res.status(201).json(inserted);
  } catch (err) {
    console.error("Failed to insert coupon:", err);
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/coupons/:id — update existing
router.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  try {
    await db
      .update(couponsTable)
      .set(req.body)
      .where(eq(couponsTable.id, id));
    const [updated] = await db
      .select()
      .from(couponsTable)
      .where(eq(couponsTable.id, id));
    res.json(updated);
  } catch (err) {
    console.error("Failed to update coupon:", err);
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/coupons/:id — delete
router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  try {
    await db.delete(couponsTable).where(eq(couponsTable.id, id));
    res.sendStatus(204);
  } catch (err) {
    console.error("Failed to delete coupon:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/coupons/validate — validate coupon code for user
router.post("/validate", async (req, res) => {
  const { code, userId } = req.body;

  if (!code || !userId) {
    return res.status(400).json({ error: "Coupon code and user ID are required" });
  }

  try {
    // Fetch coupon
    const [coupon] = await db.select().from(couponsTable).where(eq(couponsTable.code, code));
    if (!coupon) {
      return res.status(404).json({ error: "Coupon not found" });
    }

    const now = new Date();
    if (coupon.validFrom && now < new Date(coupon.validFrom)) {
      return res.status(400).json({ error: "Coupon not yet valid" });
    }
    if (coupon.validUntil && now > new Date(coupon.validUntil)) {
      return res.status(400).json({ error: "Coupon expired" });
    }

    // First order only check
    if (coupon.firstOrderOnly) {
      const userOrders = await db
        .select()
        .from(ordersTable)
        .where(eq(ordersTable.userId, userId));
      if (userOrders.length > 0) {
        return res.status(400).json({ error: "Coupon only valid for first order" });
      }
    }

    // User usage of this coupon
    const usedCouponOrders = await db
      .select()
      .from(ordersTable)
      .where(
        and(
          eq(ordersTable.userId, userId),
          eq(ordersTable.couponCode, code)
        )
      );

    if (
      coupon.maxUsagePerUser !== null &&
      usedCouponOrders.length >= coupon.maxUsagePerUser
    ) {
      return res.status(400).json({ error: "Coupon usage limit reached" });
    }

    res.json({ success: true, coupon });

  } catch (err) {
    console.error("Coupon validation failed:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/coupons/available — list valid coupons for user
router.get("/available", async (req, res) => {
  const userId = req.query.userId;
  if (!userId || typeof userId !== "string") {
    return res.status(400).json({ error: "Valid userId is required" });
  }

  try {
    // Fetch all coupons
    const allCoupons = await db.select().from(couponsTable);

    // Fetch user's orders
    const usages = await db
      .select()
      .from(ordersTable)
      .where(eq(ordersTable.userId, userId));

    // Build map of couponCode -> usage count
    const usageMap = {};
    usages.forEach(order => {
      if (order.couponCode) {
        usageMap[order.couponCode] = (usageMap[order.couponCode] || 0) + 1;
      }
    });

    const now = new Date();

    // Filter coupons
    const availableCoupons = allCoupons.filter(coupon => {
      const usageCount = usageMap[coupon.code] || 0;

      if (coupon.maxUsagePerUser !== null && usageCount >= coupon.maxUsagePerUser) {
        return false;
      }

      if (coupon.validFrom && now < new Date(coupon.validFrom)) {
        return false;
      }

      if (coupon.validUntil && now > new Date(coupon.validUntil)) {
        return false;
      }

      if (coupon.firstOrderOnly) {
        const userOrderCount = usages.length;
        if (userOrderCount > 0) {
          return false;
        }
      }

      return true;
    });

    res.json(availableCoupons);
  } catch (err) {
    console.error("Failed to load available coupons:", err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
