// ✅ file: routes/coupons.js
import 'dotenv/config';
import express from "express";
import { db } from "../configs/index.js";
import { 
    couponsTable, 
    ordersTable, 
    activityLogsTable, 
    usersTable, 
    notificationsTable,
    couponRedemptionsTable // 🟢 NEW: Required for accurate usage limits
} from "../configs/schema.js";
import { eq, and, isNull, gte, lte, or } from "drizzle-orm"; 

import { cache } from "../cacheMiddleware.js";
import { invalidateMultiple } from "../invalidateHelpers.js";
import { makeAllCouponsKey, makeAvailableCouponsKey } from "../cacheKeys.js";

// 🔒 SECURITY: Import Middleware
import { requireAuth, verifyAdmin } from "../middleware/authMiddleware.js";

// Import Notification Logic
import { sendPushNotification, sendPromotionalEmail } from "./notifications.js";

// 🟢 NEW: Import Single Source of Truth
import { userMatchesSegment } from "../helpers/segmentMatcher.js";

const router = express.Router();

// --- 🟢 Comprehensive User Filter (Refactored) ---
const filterUsersByCategory = async (category) => {
    console.log(`[COUPON-LOG] Filtering users for category: ${category}`);
    try {
        // Drizzle Relational Query gets users with orders instantly
        const allUsers = await db.query.usersTable.findMany({
            with: { orders: true }
        });

        // Use the centralized matcher
        return allUsers.filter(user => userMatchesSegment(user, user.orders || [], category));
    } catch (err) {
        console.error("[COUPON-LOG] ❌ Filter Error:", err);
        return [];
    }
};

// --- 🟢 Helper: Send Single Notification ---
const notifyUser = async (user, coupon, isUpdate = false) => {
    if (!user) return;
    
    const actionText = isUpdate ? "Updated Offer" : "Exclusive Offer";
    const promoTitle = `${actionText}: ${coupon.code}`;
    const promoMsg = coupon.description || (isUpdate 
        ? `We've updated the terms for code ${coupon.code}. Check it out!` 
        : `Special deal for you! Use code ${coupon.code}`);
    const promoLink = '/user?tab=offers';

    try {
        await db.insert(notificationsTable).values({
            userId: user.id,
            message: promoMsg,
            link: promoLink,
            type: 'coupon',
            isRead: false,
            createdAt: new Date()
        });
    } catch (err) { console.error(`❌ In-App failed: ${err.message}`); }

    if (user.email && user.notify_promos) {
        try {
            await sendPromotionalEmail(
                user.email, user.name, coupon.code, coupon.description,
                coupon.discountValue, coupon.discountType
            );
        } catch (err) { console.error(`❌ Email failed: ${err.message}`); }
    }

    if (user.pushSubscription && user.notify_promos) {
        try {
            await sendPushNotification(user.pushSubscription, {
                title: promoTitle, body: promoMsg, url: promoLink
            });
        } catch (err) { console.error(`❌ Push failed: ${err.message}`); }
    }
};

/* -------------------------------------------------------
   🔒 GET /api/coupons — list all (ADMIN ONLY)
-------------------------------------------------------- */
router.get("/", requireAuth, verifyAdmin, cache(() => makeAllCouponsKey(), 3600), async (req, res) => {
  try {
    const all = await db.select().from(couponsTable);
    res.json(all);
  } catch (err) {
    console.error("❌ Failed to load coupons:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* -------------------------------------------------------
   🔒 POST /api/coupons — Create (ADMIN ONLY)
-------------------------------------------------------- */
router.post("/", requireAuth, verifyAdmin, async (req, res) => {
  try {
    const { targetUserId, targetCategory, ...body } = req.body; 
    
    const requesterClerkId = req.auth.userId;
    const adminUser = await db.query.usersTable.findFirst({
        where: eq(usersTable.clerkId, requesterClerkId),
        columns: { id: true }
    });
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
      totalUsageLimit: body.totalUsageLimit !== undefined ? body.totalUsageLimit : null, // 🟢 NEW
      isActive: body.isActive !== undefined ? body.isActive : true, // 🟢 NEW
    };

    const [inserted] = await db.insert(couponsTable).values(payload).returning();
    console.log(`[COUPON-LOG] Coupon Created: ${inserted.code}`);

    if (actorId) {
        let desc = `Created coupon: ${inserted.code}`;
        if (targetUserId) desc += ' (Targeted User)';
        if (targetCategory) desc += ` (Targeted Category: ${targetCategory})`;

        await db.insert(activityLogsTable).values({
            userId: actorId, 
            action: 'COUPON_CREATE',
            description: desc,
            performedBy: 'admin',
            metadata: { couponId: inserted.id }
        });
    }

    (async () => {
        try {
            if (targetUserId) {
                const [u] = await db.select().from(usersTable).where(eq(usersTable.id, targetUserId));
                if (u) await notifyUser(u, inserted, false);
            } 
            else if (targetCategory) {
                const targetUsers = await filterUsersByCategory(targetCategory);
                for (const u of targetUsers) await notifyUser(u, inserted, false);
            }
        } catch (notificationErr) { console.error("❌ Notification Failure:", notificationErr); }
    })();

    await invalidateMultiple([
      { key: makeAllCouponsKey() },
      { key: "coupons:available", prefix: true },
      { key: "coupons:auto-offers" }, 
      { key: "promos:latest-public" }
    ]);

    res.status(201).json(inserted);
  } catch (err) {
    console.error("❌ Failed to insert coupon:", err);
    res.status(400).json({ error: err.message });
  }
});

/* -------------------------------------------------------
   🟢 GET /api/coupons/validate (PUBLIC/USER)
   Removed Cache wrapper to ensure accurate real-time limits
-------------------------------------------------------- */
router.get("/validate", async (req, res) => {
    const { code, userId } = req.query;

    if (!code || !userId) return res.status(400).json({ error: "Required fields missing" });

    try {
      const [coupon] = await db.select().from(couponsTable).where(eq(couponsTable.code, code));

      if (!coupon) return res.status(404).json({ message: "Coupon not found" });
      if (!coupon.isActive) return res.status(400).json({ message: "This coupon is currently inactive." });
      if (coupon.isAutomatic) return res.status(400).json({ message: "This offer is applied automatically." });

      if (coupon.targetUserId && coupon.targetUserId !== userId) {
        return res.status(403).json({ message: "This coupon is not valid for your account." });
      }

      // Check Category Validation via the Master Helper
      if (coupon.targetCategory) {
          const user = await db.query.usersTable.findFirst({ where: eq(usersTable.id, userId), with: { orders: true } });
          if (!user) return res.status(403).json({ message: "User not found." });

          if (!userMatchesSegment(user, user.orders || [], coupon.targetCategory)) {
              return res.status(403).json({ message: "You do not meet eligibility criteria." });
          }
      }

      const now = new Date();
      if (coupon.validFrom && now < new Date(coupon.validFrom)) return res.status(400).json({ message: "Not yet valid" });
      if (coupon.validUntil && now > new Date(coupon.validUntil)) return res.status(400).json({ message: "Expired" });

      // 🟢 Check Global Total Usage Limit
      if (coupon.totalUsageLimit !== null) {
          const totalRedemptions = await db.select().from(couponRedemptionsTable).where(eq(couponRedemptionsTable.couponId, coupon.id));
          if (totalRedemptions.length >= coupon.totalUsageLimit) {
              return res.status(400).json({ message: "Global usage limit reached for this coupon." });
          }
      }

      // 🟢 Accurately check user history using new redemptions/orders setup
      if (coupon.firstOrderOnly) {
        const userOrders = await db.select().from(ordersTable).where(eq(ordersTable.userId, userId));
        if (userOrders.length > 0) return res.status(400).json({ message: "First order only" });
      }

      if (coupon.maxUsagePerUser !== null) {
        const userRedemptions = await db.select().from(couponRedemptionsTable).where(
            and(eq(couponRedemptionsTable.couponId, coupon.id), eq(couponRedemptionsTable.userId, userId))
        );
        if (userRedemptions.length >= coupon.maxUsagePerUser) {
          return res.status(400).json({ message: "Usage limit reached" });
        }
      }

      res.json(coupon);
    } catch (err) {
      console.error("❌ Coupon validation failed:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

/* -------------------------------------------------------
   🟢 GET /api/coupons/available (PUBLIC/USER)
-------------------------------------------------------- */
router.get(
  "/available",
  cache((req) => makeAvailableCouponsKey(req.query.userId || ""), 300),
  async (req, res) => {
    const userId = req.query.userId;
    const now = new Date();

    try {
      let userData = null;
      let userRedemptionsMap = {}; // Tracks usage accurately

      if (userId) {
          userData = await db.query.usersTable.findFirst({
              where: eq(usersTable.id, userId),
              with: { orders: true }
          });

          const redemptions = await db.select().from(couponRedemptionsTable).where(eq(couponRedemptionsTable.userId, userId));
          redemptions.forEach(r => {
              userRedemptionsMap[r.couponId] = (userRedemptionsMap[r.couponId] || 0) + 1;
          });
      }

      const allCoupons = await db.select().from(couponsTable).where(
          and(
            eq(couponsTable.isActive, true), // Only active
            or(isNull(couponsTable.targetUserId), eq(couponsTable.targetUserId, userId || '00000000-0000-0000-0000-000000000000'))
          )
      );

      const availableCoupons = allCoupons.filter((coupon) => {
        if (coupon.targetCategory) {
            if (!userData) return false;
            // 🟢 USE SINGLE HELPER
            if (!userMatchesSegment(userData, userData.orders || [], coupon.targetCategory)) return false;
        }
        
        const usageCount = userRedemptionsMap[coupon.id] || 0;
        if (coupon.maxUsagePerUser !== null && usageCount >= coupon.maxUsagePerUser) return false;
        if (coupon.validFrom && now < new Date(coupon.validFrom)) return false;
        if (coupon.validUntil && now > new Date(coupon.validUntil)) return false;
        if (coupon.firstOrderOnly && userData && (userData.orders || []).length > 0) return false;
        
        // Note: Global usage limits are intentionally omitted here to prevent heavy DB hits on list views.
        // It gets strictly enforced during checkout and /validate.
        
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
   🔒 PUT /api/coupons/:id — Update (ADMIN ONLY)
-------------------------------------------------------- */
router.put("/:id", requireAuth, verifyAdmin, async (req, res) => {
  const id = Number(req.params.id);
  try {
    const { targetUserId, targetCategory, ...body } = req.body; 

    const requesterClerkId = req.auth.userId;
    const adminUser = await db.query.usersTable.findFirst({
        where: eq(usersTable.clerkId, requesterClerkId),
        columns: { id: true }
    });
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
      totalUsageLimit: body.totalUsageLimit !== undefined ? body.totalUsageLimit : null, // 🟢 NEW
      isActive: body.isActive !== undefined ? body.isActive : true, // 🟢 NEW
    };

    const [updated] = await db
      .update(couponsTable)
      .set(payload)
      .where(eq(couponsTable.id, id))
      .returning();

    if (actorId) {
        await db.insert(activityLogsTable).values({
            userId: actorId,
            action: 'COUPON_UPDATE',
            description: `Updated coupon: ${updated.code}`,
            performedBy: 'admin',
            metadata: { couponId: id }
        });
    }

    (async () => {
        try {
            if (targetUserId) {
                const [u] = await db.select().from(usersTable).where(eq(usersTable.id, targetUserId));
                if (u) await notifyUser(u, updated, true);
            } 
            else if (targetCategory) {
                const targetUsers = await filterUsersByCategory(targetCategory);
                for (const u of targetUsers) await notifyUser(u, updated, true);
            }
        } catch (notificationErr) { console.error("❌ Notification Failure:", notificationErr); }
    })();

    await invalidateMultiple([
      { key: makeAllCouponsKey() },
      { key: "coupons:available", prefix: true },
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
   🔒 DELETE /api/coupons/:id — Delete (ADMIN ONLY)
-------------------------------------------------------- */
router.delete("/:id", requireAuth, verifyAdmin, async (req, res) => {
  const id = Number(req.params.id);

  try {
    const requesterClerkId = req.auth.userId;
    const adminUser = await db.query.usersTable.findFirst({
        where: eq(usersTable.clerkId, requesterClerkId),
        columns: { id: true }
    });
    const actorId = adminUser?.id;

    const [coupon] = await db.select().from(couponsTable).where(eq(couponsTable.id, id));

    await db.delete(couponsTable).where(eq(couponsTable.id, id));

    if (actorId && coupon) {
        await db.insert(activityLogsTable).values({
            userId: actorId,
            action: 'COUPON_DELETE',
            description: `Deleted coupon: ${coupon.code}`,
            performedBy: 'admin',
            metadata: { couponId: id, code: coupon.code }
        });
    }

    await invalidateMultiple([
      { key: makeAllCouponsKey() },
      { key: "coupons:available", prefix: true },
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
   🟢 GET /api/coupons/automatic-offers (PUBLIC)
-------------------------------------------------------- */
router.get("/automatic-offers", cache(() => "coupons:auto-offers", 3600), async (req, res) => {
  try {
    const now = new Date();
    const { userId } = req.query; 

    let conditions = and(
        eq(couponsTable.isAutomatic, true),
        eq(couponsTable.isActive, true), // 🟢 Ensure inactive auto-offers don't apply
        or(isNull(couponsTable.validFrom), lte(couponsTable.validFrom, now)),
        or(isNull(couponsTable.validUntil), gte(couponsTable.validUntil, now))
    );

    if (userId) {
        conditions = and(conditions, or(isNull(couponsTable.targetUserId), eq(couponsTable.targetUserId, userId)));
    } else {
        conditions = and(conditions, isNull(couponsTable.targetUserId));
    }

    const allAutoOffers = await db.select().from(couponsTable).where(conditions);
    res.json(allAutoOffers);
  } catch (err) {
    console.error("❌ Failed to load automatic offers:", err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;