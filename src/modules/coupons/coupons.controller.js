import * as CouponsService from "./coupons.service.js";
import { invalidateMultiple } from "../../infrastructure/cache/cache.invalidate.js";
import { makeAllCouponsKey } from "../../infrastructure/cache/cache.keys.js";
import { db } from "../../db/client.js";
import { usersTable } from "../../db/schema/index.js";
import { eq } from "drizzle-orm";

const getUserFromToken = async (clerkId) => {
  if (!clerkId) return null;
  const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.clerkId, clerkId));
  return user;
};

export const getAllCoupons = async (req, res) => {
  try {
    const all = await CouponsService.getAllCoupons();
    res.json(all);
  } catch (err) {
    console.error("❌ Failed to load coupons:", err);
    res.status(500).json({ error: "Server error" });
  }
};

export const createCoupon = async (req, res) => {
  try {
    const { targetUserId, targetCategory, ...body } = req.body; 
    
    const adminUser = await getUserFromToken(req.auth.userId);
    const actorId = adminUser?.id;

    const payload = {
      code: body.code,
      description: body.description,
      discountType: body.discountType,
      discountValue: body.discountValue,
      minOrderValue: body.minOrderValue,
      minItemCount: body.minItemCount,
      maxDiscountAmount: body.maxDiscountAmount, 
      validFrom: body.validFrom ? new Date(body.validFrom) : null,
      validUntil: body.validUntil ? new Date(body.validUntil) : null,
      firstOrderOnly: body.firstOrderOnly,
      maxUsagePerUser: body.maxUsagePerUser,
      isAutomatic: body.isAutomatic,
      cond_requiredCategory: body.cond_requiredCategory,
      cond_requiredSize: body.cond_requiredSize,
      action_targetSize: body.action_targetSize,
      action_targetMaxPrice: body.action_targetMaxPrice,
      action_buyX: body.action_buyX,
      action_getY: body.action_getY,
      targetUserId: targetUserId || null,
      targetCategory: targetCategory || null,
      totalUsageLimit: body.totalUsageLimit !== undefined ? body.totalUsageLimit : null, 
      isActive: body.isActive !== undefined ? body.isActive : true, 
    };

    const inserted = await CouponsService.createCoupon(payload, actorId, targetUserId, targetCategory);

    await invalidateMultiple([
      { key: makeAllCouponsKey() },
      { key: "coupons:available", prefix: true },
      { key: "coupons:auto-offers" }, 
      { key: "coupons:auto-offers:raw" }, 
      { key: "promos:latest-public" }
    ]);

    res.status(201).json(inserted);
  } catch (err) {
    console.error("❌ Failed to insert coupon:", err);
    res.status(400).json({ error: err.message });
  }
};

export const validateCoupon = async (req, res) => {
  const { code, userId } = req.query;

  if (!code || !userId) return res.status(400).json({ error: "Required fields missing" });

  try {
    const coupon = await CouponsService.validateCoupon(code, userId);
    res.json(coupon);
  } catch (err) {
    if (["Coupon not found"].includes(err.message)) {
      return res.status(404).json({ message: err.message });
    }
    if (["This coupon is not valid for your account.", "User not found.", "You do not meet eligibility criteria."].includes(err.message)) {
      return res.status(403).json({ message: err.message });
    }
    if ([
      "This coupon is currently inactive.", 
      "This offer is applied automatically.", 
      "Not yet valid", 
      "Expired", 
      "Global usage limit reached for this coupon.", 
      "First order only", 
      "Usage limit reached"
    ].includes(err.message)) {
      return res.status(400).json({ message: err.message });
    }

    console.error("❌ Coupon validation failed:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export const getAvailableCoupons = async (req, res) => {
  const userId = req.query.userId;

  try {
    const availableCoupons = await CouponsService.getAvailableCoupons(userId);
    res.json(availableCoupons);
  } catch (err) {
    console.error("❌ Failed to load available coupons:", err);
    res.status(500).json({ error: "Server error" });
  }
};

export const updateCoupon = async (req, res) => {
  const id = Number(req.params.id);
  try {
    const { targetUserId, targetCategory, ...body } = req.body; 

    const adminUser = await getUserFromToken(req.auth.userId);
    const actorId = adminUser?.id;

    const payload = {
      code: body.code,
      description: body.description,
      discountType: body.discountType,
      discountValue: body.discountValue,
      minOrderValue: body.minOrderValue,
      minItemCount: body.minItemCount,
      maxDiscountAmount: body.maxDiscountAmount, 
      validFrom: body.validFrom ? new Date(body.validFrom) : null,
      validUntil: body.validUntil ? new Date(body.validUntil) : null,
      firstOrderOnly: body.firstOrderOnly,
      maxUsagePerUser: body.maxUsagePerUser,
      isAutomatic: body.isAutomatic,
      cond_requiredCategory: body.cond_requiredCategory,
      cond_requiredSize: body.cond_requiredSize, 
      action_targetSize: body.action_targetSize,
      action_targetMaxPrice: body.action_targetMaxPrice,
      action_buyX: body.action_buyX,
      action_getY: body.action_getY,
      targetUserId: targetUserId || null,
      targetCategory: targetCategory || null,
      totalUsageLimit: body.totalUsageLimit !== undefined ? body.totalUsageLimit : null, 
      isActive: body.isActive !== undefined ? body.isActive : true, 
    };

    const updated = await CouponsService.updateCoupon(id, payload, actorId, targetUserId, targetCategory);

    await invalidateMultiple([
      { key: makeAllCouponsKey() },
      { key: "coupons:available", prefix: true },
      { key: "coupons:auto-offers" },
      { key: "coupons:auto-offers:raw" },
      { key: "promos:latest-public" }
    ]);

    res.json(updated);
  } catch (err) {
    console.error("❌ Failed to update coupon:", err);
    res.status(400).json({ error: err.message });
  }
};

export const deleteCoupon = async (req, res) => {
  const id = Number(req.params.id);

  try {
    const adminUser = await getUserFromToken(req.auth.userId);
    const actorId = adminUser?.id;

    await CouponsService.deleteCoupon(id, actorId);

    await invalidateMultiple([
      { key: makeAllCouponsKey() },
      { key: "coupons:available", prefix: true },
      { key: "coupons:auto-offers" },
      { key: "coupons:auto-offers:raw" },
      { key: "promos:latest-public" }
    ]);

    res.sendStatus(204);
  } catch (err) {
    console.error("❌ Failed to delete coupon:", err);
    res.status(500).json({ error: "Server error" });
  }
};

export const getAutomaticOffers = async (req, res) => {
  try {
    const { userId } = req.query; 
    const allAutoOffers = await CouponsService.getAutomaticOffers(userId);
    res.json(allAutoOffers);
  } catch (err) {
    console.error("❌ Failed to load automatic offers:", err);
    res.status(500).json({ error: "Server error" });
  }
};
