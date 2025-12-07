// routes/coupons.js
import 'dotenv/config'; // Ensure env vars are loaded
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

// Import Notification Logic
import { sendPushNotification, sendPromotionalEmail } from "./notifications.js";

const router = express.Router();

// --- 🟢 Comprehensive User Filter ---
const filterUsersByCategory = async (category) => {
    console.log(`[COUPON-LOG] Filtering users for category: ${category}`);
    const now = new Date();
    
    // Time constants
    const thirtyDaysAgo = new Date(new Date().setDate(now.getDate() - 30));
    const sixtyDaysAgo = new Date(new Date().setDate(now.getDate() - 60));
    const twoWeeksAgo = new Date(new Date().setDate(now.getDate() - 14));

    try {
        // 1. Get All Users
        const allUsers = await db.select().from(usersTable);
        
        // 2. Get All Orders (Optimization: Only fetch needed fields)
        const allOrders = await db.select({ 
            userId: ordersTable.userId, 
            totalAmount: ordersTable.totalAmount, 
            createdAt: ordersTable.createdAt,
            couponCode: ordersTable.couponCode
        }).from(ordersTable);

        // 3. Map orders to users
        const userOrdersMap = {};
        allOrders.forEach(o => {
            if (!userOrdersMap[o.userId]) userOrdersMap[o.userId] = [];
            userOrdersMap[o.userId].push(o);
        });

        // 4. Filter Logic
        const filtered = allUsers.filter(user => {
            const orders = userOrdersMap[user.id] || [];
            
            // Basic Metrics
            const totalSpent = orders.reduce((sum, o) => sum + o.totalAmount, 0);
            const orderCount = orders.length;
            const lastOrderDate = orders.length > 0 
                ? new Date(Math.max(...orders.map(o => new Date(o.createdAt)))) 
                : null;
            const joinDate = new Date(user.createdAt);
            const aov = orderCount > 0 ? totalSpent / orderCount : 0;

            switch (category) {
                // --- STANDARD CATEGORIES ---
                case 'new_user':
                    // Joined < 30 days ago
                    return joinDate > thirtyDaysAgo;
                case 'vip':
                    // Spent > 10,000
                    return totalSpent > 10000;
                case 'returning':
                    // More than 2 orders
                    return orderCount > 2;
                case 'inactive':
                    // Has ordered before, but NOT in last 60 days
                    return orderCount > 0 && lastOrderDate && lastOrderDate < sixtyDaysAgo;

                // --- EXPANSION CATEGORIES ---
                case 'one_time_buyer':
                    // Bought exactly once
                    return orderCount === 1;
                case 'big_spenders':
                    // High Average Order Value (> 2000 per order)
                    return aov > 2000;
                case 'almost_vip':
                    // Close to VIP threshold (7k - 10k) - Good for upsell
                    return totalSpent >= 7000 && totalSpent < 10000;
                case 'loyal_customers':
                    // High frequency (> 10 orders) regardless of price
                    return orderCount >= 10;
                case 'subscribers':
                    // Explicitly opted into notifications
                    return user.notify_promos === true;
                case 'frequent_low_spender':
                    // Buys often (>5) but spends little (<5k total) - Good for bulk discounts
                    return orderCount > 5 && totalSpent < 5000;

                // --- UNIQUE / BEHAVIORAL CATEGORIES ---
                case 'coupon_hunter':
                    // >75% of their orders used a coupon
                    if (orderCount < 2) return false;
                    const couponOrders = orders.filter(o => o.couponCode).length;
                    return (couponOrders / orderCount) >= 0.75;

                case 'churn_risk':
                    // Regular buyer (>3 orders) who hasn't bought in 45-90 days (Drifting away)
                    if (!lastOrderDate || orderCount < 3) return false;
                    const daysSince = Math.ceil(Math.abs(new Date() - lastOrderDate) / (1000 * 60 * 60 * 24));
                    return daysSince > 45 && daysSince <= 90;

                case 'trending_user':
                    // High velocity: 2+ orders in last 14 days
                    const recent = orders.filter(o => new Date(o.createdAt) > twoWeeksAgo);
                    return recent.length >= 2;

                case 'anniversary_month':
                    // Joined in this month in a previous year (Send "Happy Anniversary" gift)
                    const currentMonth = new Date().getMonth();
                    return joinDate.getMonth() === currentMonth && joinDate.getFullYear() < new Date().getFullYear();

                case 'whale':
                    // The Top 1% Spender (> 50k) - Give them exclusive access
                    return totalSpent > 50000;

                case 'weekend_shopper':
                    // >60% of orders placed on Sat/Sun - Target them on Fridays
                    if (orderCount < 2) return false;
                    const weekends = orders.filter(o => {
                        const d = new Date(o.createdAt).getDay();
                        return d === 0 || d === 6; // 0=Sun, 6=Sat
                    }).length;
                    return (weekends / orderCount) > 0.6;

                default:
                    return false;
            }
        });

        console.log(`[COUPON-LOG] Found ${filtered.length} users for ${category}`);
        return filtered;

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
    // If update, emphasize checking the changes
    const promoMsg = coupon.description || (isUpdate 
        ? `We've updated the terms for code ${coupon.code}. Check it out!` 
        : `Special deal for you! Use code ${coupon.code}`);
        
    const promoLink = '/user?tab=offers';

    console.log(`[COUPON-LOG] 🔔 Notifying: ${user.email} (ID: ${user.id}) [Update: ${isUpdate}]`);

    // 1. In-App Notification (Database)
    try {
        await db.insert(notificationsTable).values({
            userId: user.id,
            message: promoMsg,
            link: promoLink,
            type: 'coupon',
            isRead: false,
            createdAt: new Date()
        });
        console.log(`   ✅ In-App saved`);
    } catch (err) {
        console.error(`   ❌ In-App failed: ${err.message}`);
    }

    // 2. Email Notification
    if (user.email && user.notify_promos) {
        try {
            await sendPromotionalEmail(
                user.email,
                user.name,
                coupon.code,
                coupon.description,
                coupon.discountValue,
                coupon.discountType
            );
            console.log(`   ✅ Email sent`);
        } catch (err) {
            console.error(`   ❌ Email failed: ${err.message}`);
        }
    }

    // 3. Push Notification
    if (user.pushSubscription && user.notify_promos) {
        try {
            await sendPushNotification(user.pushSubscription, {
                title: promoTitle,
                body: promoMsg,
                url: promoLink
            });
            console.log(`   ✅ Push sent`);
        } catch (err) {
            console.error(`   ❌ Push failed: ${err.message}`);
        }
    }
};

/* -------------------------------------------------------
   GET /api/coupons — list all coupons (admin)
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
   🟢 POST /api/coupons — Create & Notify
-------------------------------------------------------- */
router.post("/", async (req, res) => {
  try {
    const { actorId, targetUserId, targetCategory, ...body } = req.body; 

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
    console.log(`[COUPON-LOG] Coupon Created: ${inserted.code} (ID: ${inserted.id})`);

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

    // 3. 🟢 NOTIFICATION PROCESSING (CREATE)
    (async () => {
        try {
            if (targetUserId) {
                console.log(`[COUPON-LOG] Targeting Specific User ID: ${targetUserId}`);
                const [u] = await db.select().from(usersTable).where(eq(usersTable.id, targetUserId));
                if (u) await notifyUser(u, inserted, false);
            } 
            else if (targetCategory) {
                console.log(`[COUPON-LOG] Targeting Category: ${targetCategory}`);
                const targetUsers = await filterUsersByCategory(targetCategory);
                for (const u of targetUsers) await notifyUser(u, inserted, false);
            }
        } catch (notificationErr) {
            console.error("[COUPON-LOG] ❌ NOTIFICATION FAILURE:", notificationErr);
        }
    })();

    // 4. Invalidate caches
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
   GET /api/coupons/validate
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

      // Check Category Validation using same logic but for single user
      if (coupon.targetCategory) {
          const user = await db.query.usersTable.findFirst({ where: eq(usersTable.id, userId), with: { orders: true } });
          if (!user) return res.status(403).json({ message: "User not found." });

          // Helper to reuse logic would be best, but for speed, we repeat the check
          const totalSpent = user.orders.reduce((sum, o) => sum + o.totalAmount, 0);
          const orderCount = user.orders.length;
          const aov = orderCount > 0 ? totalSpent / orderCount : 0;
          const now = new Date();
          const lastOrderDate = orderCount > 0 ? new Date(Math.max(...user.orders.map(o => new Date(o.createdAt)))) : null;
          const joinDate = new Date(user.createdAt);

          let matches = false;
          
          switch (coupon.targetCategory) {
              case 'new_user': matches = orderCount === 0; break; // stricter check for validation
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
              default: matches = true; // Fallback
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
   GET /api/coupons/available
-------------------------------------------------------- */
router.get(
  "/available",
  cache((req) => makeAvailableCouponsKey(req.query.userId || ""), 300),
  async (req, res) => {
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
          or(
              isNull(couponsTable.targetUserId), 
              eq(couponsTable.targetUserId, userId || '00000000-0000-0000-0000-000000000000') 
          )
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
            const aov = orderCount > 0 ? totalSpent / orderCount : 0;
            const lastOrderDate = orderCount > 0 ? new Date(Math.max(...userData.orders.map(o => new Date(o.createdAt)))) : null;
            const joinDate = new Date(userData.createdAt);
            
            const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            const sixtyDaysAgo = new Date(); sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
            const twoWeeksAgo = new Date(); twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

            switch(coupon.targetCategory) {
                // Standard
                case 'new_user': return joinDate > thirtyDaysAgo;
                case 'vip': return totalSpent > 10000;
                case 'returning': return orderCount > 2;
                case 'inactive': return orderCount > 0 && lastOrderDate && lastOrderDate < sixtyDaysAgo;
                
                // Expansion
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
   🟢 PUT /api/coupons/:id — Update & Notify (FIXED)
-------------------------------------------------------- */
router.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  try {
    const { actorId, targetUserId, targetCategory, ...body } = req.body; 

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
      targetCategory: targetCategory || null, // 🟢 Update
    };

    const [updated] = await db
      .update(couponsTable)
      .set(payload)
      .where(eq(couponsTable.id, id))
      .returning();

    // 🟢 LOG ACTIVITY
    if (actorId) {
        await db.insert(activityLogsTable).values({
            userId: actorId,
            action: 'COUPON_UPDATE',
            description: `Updated coupon: ${updated.code}`,
            performedBy: 'admin',
            metadata: { couponId: id }
        });
    }

    // 3. 🟢 NOTIFICATION PROCESSING (UPDATE)
    (async () => {
        try {
            if (targetUserId) {
                console.log(`[COUPON-LOG] Targeting Specific User ID (Update): ${targetUserId}`);
                const [u] = await db.select().from(usersTable).where(eq(usersTable.id, targetUserId));
                if (u) await notifyUser(u, updated, true);
            } 
            else if (targetCategory) {
                console.log(`[COUPON-LOG] Targeting Category (Update): ${targetCategory}`);
                const targetUsers = await filterUsersByCategory(targetCategory);
                for (const u of targetUsers) await notifyUser(u, updated, true);
            }
        } catch (notificationErr) {
            console.error("[COUPON-LOG] ❌ NOTIFICATION FAILURE:", notificationErr);
        }
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
   DELETE /api/coupons/:id
-------------------------------------------------------- */
router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { actorId } = req.body;

  try {
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
   GET /api/coupons/automatic-offers
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