// backend/src/routes/coupons.js
import express from "express";
import { db } from "../configs/index.js";
import { couponsTable } from "../configs/schema.js";
import { eq } from "drizzle-orm";

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
    // 1️⃣ Fetch coupon
    const [coupon] = await db.select().from(couponsTable).where(eq(couponsTable.code, code));
    if (!coupon) {
      return res.status(404).json({ error: "Coupon not found" });
    }

    // 2️⃣ Check validity period
    const now = new Date();
    if (coupon.validFrom && now < new Date(coupon.validFrom)) {
      return res.status(400).json({ error: "Coupon not yet valid" });
    }
    if (coupon.validUntil && now > new Date(coupon.validUntil)) {
      return res.status(400).json({ error: "Coupon expired" });
    }

    // 3️⃣ Check first-order-only
    if (coupon.isFirstOrderOnly) {
      const orders = await db.query.ordersTable.findMany({
        where: eq("user_id", userId),
      });
      if (orders.length > 0) {
        return res.status(400).json({ error: "Coupon only valid for first order" });
      }
    }

    // 4️⃣ Check user usage of this coupon
    const usage = await db.query.ordersTable.findMany({
      where: (order) => eq(order.userId, userId) && eq(order.couponCode, code),
    });
    if (coupon.maxUsagePerUser !== null && usage.length >= coupon.maxUsagePerUser) {
      return res.status(400).json({ error: "Coupon usage limit reached" });
    }

    // ✅ Valid coupon
    res.json({ success: true, coupon });

  } catch (err) {
    console.error("Coupon validation failed:", err);
    res.status(500).json({ error: "Server error" });
  }
});


export default router;
