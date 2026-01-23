// ✅ file: routes/coupons.js
import 'dotenv/config';
import express from "express";
import { db } from "../configs/index.js";
import { 
    couponsTable, 
    ordersTable, 
    activityLogsTable, 
    usersTable, 
    notificationsTable 
} from "../configs/schema.js";
import { eq, and, isNull, gte, lte, or } from "drizzle-orm"; 

import { cache } from "../cacheMiddleware.js";
import { invalidateMultiple } from "../invalidateHelpers.js";
import { makeAllCouponsKey, makeCouponValidationKey, makeAvailableCouponsKey } from "../cacheKeys.js";

// 🔒 SECURITY: Import Middleware
import { requireAuth, verifyAdmin } from "../middleware/authMiddleware.js";

// Import Notification Logic
import { sendPushNotification, sendPromotionalEmail } from "./notifications.js";

const router = express.Router();

// --- 🟢 Comprehensive User Filter ---
const filterUsersByCategory = async (category) => {
    // ... (Keep existing filter logic) ...
    console.log(`[COUPON-LOG] Filtering users for category: ${category}`);
    const now = new Date();
    
    const thirtyDaysAgo = new Date(new Date().setDate(now.getDate() - 30));
    const sixtyDaysAgo = new Date(new Date().setDate(now.getDate() - 60));
    const twoWeeksAgo = new Date(new Date().setDate(now.getDate() - 14));

    try {
        const allUsers = await db.select().from(usersTable);
        
        const allOrders = await db.select({ 
            userId: ordersTable.userId, 
            totalAmount: ordersTable.totalAmount, 
            createdAt: ordersTable.createdAt,
            couponCode: ordersTable.couponCode
        }).from(ordersTable);

        const userOrdersMap = {};
        allOrders.forEach(o => {
            if (!userOrdersMap[o.userId]) userOrdersMap[o.userId] = [];
            userOrdersMap[o.userId].push(o);
        });

        const filtered = allUsers.filter(user => {
            const orders = userOrdersMap[user.id] || [];
            
            const totalSpent = orders.reduce((sum, o) => sum + o.totalAmount, 0);
            const orderCount = orders.length;
            const lastOrderDate = orders.length > 0 
                ? new Date(Math.max(...orders.map(o => new Date(o.createdAt)))) 
                : null;
            const joinDate = new Date(user.createdAt);
            const aov = orderCount > 0 ? totalSpent / orderCount : 0;

            switch (category) {
                case 'new_user': return joinDate > thirtyDaysAgo;
                case 'vip': return totalSpent > 10000;
                case 'returning': return orderCount > 2;
                case 'inactive': return orderCount > 0 && lastOrderDate && lastOrderDate < sixtyDaysAgo;
                case 'one_time_buyer': return orderCount === 1;
                case 'big_spenders': return aov > 2000;
                case 'almost_vip': return totalSpent >= 7000 && totalSpent < 10000;
                case 'loyal_customers': return orderCount >= 10;
                case 'subscribers': return user.notify_promos === true;
                case 'frequent_low_spender': return orderCount > 5 && totalSpent < 5000;
                case 'coupon_hunter':
                    if (orderCount < 2) return false;
                    const couponOrders = orders.filter(o => o.couponCode).length;
                    return (couponOrders / orderCount) >= 0.75;
                case 'churn_risk':
                    if (!lastOrderDate || orderCount < 3) return false;
                    const daysSince = Math.ceil(Math.abs(new Date() - lastOrderDate) / (1000 * 60 * 60 * 24));
                    return daysSince > 45 && daysSince <= 90;
                case 'trending_user':
                    const recent = orders.filter(o => new Date(o.createdAt) > twoWeeksAgo);
                    return recent.length >= 2;
                case 'anniversary_month':
                    const currentMonth = new Date().getMonth();
                    return joinDate.getMonth() === currentMonth && joinDate.getFullYear() < new Date().getFullYear();
                case 'whale': return totalSpent > 50000;
                case 'weekend_shopper':
                    if (orderCount < 2) return false;
                    const weekends = orders.filter(o => {
                        const d = new Date(o.createdAt).getDay();
                        return d === 0 || d === 6; 
                    }).length;
                    return (weekends / orderCount) > 0.6;
                default: return false;
            }
        });
        return filtered;
    } catch (err) {
        console.error("[COUPON-LOG] ❌ Filter Error:", err);
        return [];
    }
};

// --- 🟢 Helper: Send Single Notification ---
const notifyUser = async (user, coupon, isUpdate = false) => {
    // ... (Keep existing notification logic) ...
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
    
    // 🟢 SECURE: Resolve Actor ID from Token
    const requesterClerkId = req.auth.userId;
    const adminUser = await db.query.usersTable.findFirst({
        where: eq(usersTable.clerkId, requesterClerkId),
        columns: { id: true }
    });
    const actorId = adminUser?.id;

    // 1. Insert Coupon
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
    };

    const [inserted] = await db.insert(couponsTable).values(payload).returning();
    console.log(`[COUPON-LOG] Coupon Created: ${inserted.code}`);

    // 2. Log Activity
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

    // 3. Notification Logic
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
      { key: "coupons:validate", prefix: true },
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
   Kept public for checkout (guest or user)
-------------------------------------------------------- */
router.get(
  "/validate",
  cache((req) => makeCouponValidationKey(req.query.code, req.query.userId), 60),
  async (req, res) => {
    const { code, userId } = req.query;

    if (!code || !userId) return res.status(400).json({ error: "Required fields missing" });

    try {
      const [coupon] = await db.select().from(couponsTable).where(eq(couponsTable.code, code));

      if (!coupon) return res.status(404).json({ message: "Coupon not found" });
      if (coupon.isAutomatic) return res.status(400).json({ message: "This offer is applied automatically." });

      if (coupon.targetUserId && coupon.targetUserId !== userId) {
        return res.status(403).json({ message: "This coupon is not valid for your account." });
      }

      // Check Category Validation
      if (coupon.targetCategory) {
          const user = await db.query.usersTable.findFirst({ where: eq(usersTable.id, userId), with: { orders: true } });
          if (!user) return res.status(403).json({ message: "User not found." });

          const totalSpent = user.orders.reduce((sum, o) => sum + o.totalAmount, 0);
          const orderCount = user.orders.length;
          const aov = orderCount > 0 ? totalSpent / orderCount : 0;
          const now = new Date();
          const lastOrderDate = orderCount > 0 ? new Date(Math.max(...user.orders.map(o => new Date(o.createdAt)))) : null;
          const joinDate = new Date(user.createdAt);

          let matches = false;
          switch (coupon.targetCategory) {
              case 'new_user': matches = orderCount === 0; break;
              case 'vip': matches = totalSpent > 10000; break;
              case 'returning': matches = orderCount > 2; break;
              case 'inactive': matches = orderCount > 0 && lastOrderDate && (now - lastOrderDate) > (60 * 24 * 60 * 60 * 1000); break;
              case 'one_time_buyer': matches = orderCount === 1; break;
              case 'big_spenders': matches = aov > 2000; break;
              case 'almost_vip': matches = totalSpent >= 7000 && totalSpent < 10000; break;
              case 'loyal_customers': matches = orderCount >= 10; break;
              case 'subscribers': matches = user.notify_promos === true; break;
              case 'frequent_low_spender': matches = orderCount > 5 && totalSpent < 5000; break;
              case 'whale': matches = totalSpent > 50000; break;
              default: matches = true;
          }

          if (!matches) return res.status(403).json({ message: "You do not meet eligibility criteria." });
      }

      const now = new Date();
      if (coupon.validFrom && now < new Date(coupon.validFrom)) return res.status(400).json({ message: "Not yet valid" });
      if (coupon.validUntil && now > new Date(coupon.validUntil)) return res.status(400).json({ message: "Expired" });

      if (coupon.firstOrderOnly) {
        const userOrders = await db.select().from(ordersTable).where(eq(ordersTable.userId, userId));
        if (userOrders.length > 0) return res.status(400).json({ message: "First order only" });
      }

      const used = await db.select().from(ordersTable).where(and(eq(ordersTable.userId, userId), eq(ordersTable.couponCode, code)));
      if (coupon.maxUsagePerUser !== null && used.length >= coupon.maxUsagePerUser) {
        return res.status(400).json({ message: "Usage limit reached" });
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
    // ... (Keep existing logic - it is safe for read-only) ...
    const userId = req.query.userId;
    const now = new Date();

    try {
      let userData = null;
      if (userId) {
          const [u] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
          if(u) {
             const ords = await db.select().from(ordersTable).where(eq(ordersTable.userId, userId));
             userData = { ...u, orders: ords };
          }
      }

      const allCoupons = await db.select().from(couponsTable).where(
          or(isNull(couponsTable.targetUserId), eq(couponsTable.targetUserId, userId || '00000000-0000-0000-0000-000000000000'))
      );

      let usages = userData?.orders || [];
      const usageMap = {};
      usages.forEach((order) => {
        if (order.couponCode) usageMap[order.couponCode] = (usageMap[order.couponCode] || 0) + 1;
      });

      const availableCoupons = allCoupons.filter((coupon) => {
        if (coupon.targetCategory) {
            if (!userData) return false;
            const totalSpent = userData.orders.reduce((sum, o) => sum + o.totalAmount, 0);
            const orderCount = userData.orders.length;
            const lastOrderDate = orderCount > 0 ? new Date(Math.max(...userData.orders.map(o => new Date(o.createdAt)))) : null;
            const joinDate = new Date(userData.createdAt);
            const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            const sixtyDaysAgo = new Date(); sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

            switch(coupon.targetCategory) {
                case 'new_user': return joinDate > thirtyDaysAgo;
                case 'vip': return totalSpent > 10000;
                case 'returning': return orderCount > 2;
                case 'inactive': return orderCount > 0 && lastOrderDate && lastOrderDate < sixtyDaysAgo;
                case 'one_time_buyer': return orderCount === 1;
                case 'big_spenders': return aov > 2000;
                case 'almost_vip': return totalSpent >= 7000 && totalSpent < 10000;
                case 'loyal_customers': return orderCount >= 10;
                case 'subscribers': return userData.notify_promos === true;
                case 'frequent_low_spender': return orderCount > 5 && totalSpent < 5000;

                // Unique
                case 'coupon_hunter': 
                    if(orderCount < 2) return false;
                    return (userData.orders.filter(o => o.couponCode).length / orderCount) >= 0.75;
                case 'churn_risk':
                    if(!lastOrderDate || orderCount < 3) return false;
                    const daysSince = Math.ceil(Math.abs(now - lastOrderDate) / (1000 * 60 * 60 * 24));
                    return daysSince > 45 && daysSince <= 90;
                case 'trending_user':
                    return userData.orders.filter(o => new Date(o.createdAt) > twoWeeksAgo).length >= 2;
                case 'anniversary_month':
                    return joinDate.getMonth() === now.getMonth() && joinDate.getFullYear() < now.getFullYear();
                case 'whale': return totalSpent > 50000;
                case 'weekend_shopper':
                    if(orderCount < 2) return false;
                    const weekends = userData.orders.filter(o => {
                        const d = new Date(o.createdAt).getDay();
                        return d === 0 || d === 6;
                    }).length;
                    return (weekends / orderCount) > 0.6;
                default: return false;
            }
        }
        
        const usageCount = usageMap[coupon.code] || 0;
        if (coupon.maxUsagePerUser !== null && usageCount >= coupon.maxUsagePerUser) return false;
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
   🔒 PUT /api/coupons/:id — Update (ADMIN ONLY)
-------------------------------------------------------- */
router.put("/:id", requireAuth, verifyAdmin, async (req, res) => {
  const id = Number(req.params.id);
  try {
    const { targetUserId, targetCategory, ...body } = req.body; 

    // 🟢 SECURE: Resolve Actor ID
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
    };

    const [updated] = await db
      .update(couponsTable)
      .set(payload)
      .where(eq(couponsTable.id, id))
      .returning();

    // 2. Log Activity
    if (actorId) {
        await db.insert(activityLogsTable).values({
            userId: actorId,
            action: 'COUPON_UPDATE',
            description: `Updated coupon: ${updated.code}`,
            performedBy: 'admin',
            metadata: { couponId: id }
        });
    }

    // 3. Notification Logic
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
   🔒 DELETE /api/coupons/:id — Delete (ADMIN ONLY)
-------------------------------------------------------- */
router.delete("/:id", requireAuth, verifyAdmin, async (req, res) => {
  const id = Number(req.params.id);

  try {
    // 🟢 SECURE: Resolve Actor ID
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
   🟢 GET /api/coupons/automatic-offers (PUBLIC)
-------------------------------------------------------- */
router.get("/automatic-offers", cache(() => "coupons:auto-offers", 3600), async (req, res) => {
  try {
    const now = new Date();
    const { userId } = req.query; 

    let conditions = and(
        eq(couponsTable.isAutomatic, true),
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