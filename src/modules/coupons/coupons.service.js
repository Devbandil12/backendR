import * as CouponsRepository from "./coupons.repository.js";
import { userMatchesSegment } from "../../modules/risk/segment-matcher.service.js";
import { sendPushNotification, sendPromotionalEmail } from "../notifications/notifications.service.js"; // Note: this might need its own service extraction later

const filterUsersByCategory = async (category) => {
  console.log(`[COUPON-LOG] Filtering users for category: ${category}`);
  try {
      const allUsers = await CouponsRepository.getAllUsersWithOrders();
      return allUsers.filter(user => userMatchesSegment(user, user.orders || [], category));
  } catch (err) {
      console.error("[COUPON-LOG] ❌ Filter Error:", err);
      return [];
  }
};

const notifyUser = async (user, coupon, isUpdate = false) => {
  if (!user) return;
  
  const actionText = isUpdate ? "Updated Offer" : "Exclusive Offer";
  const promoTitle = `${actionText}: ${coupon.code}`;
  const promoMsg = coupon.description || (isUpdate 
      ? `We've updated the terms for code ${coupon.code}. Check it out!` 
      : `Special deal for you! Use code ${coupon.code}`);
  const promoLink = '/user?tab=offers';

  try {
      await CouponsRepository.insertNotification(user.id, promoMsg, promoLink, 'coupon');
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

export const getAllCoupons = async () => {
  return await CouponsRepository.getAllCoupons();
};

export const createCoupon = async (payload, actorId, targetUserId, targetCategory) => {
  const inserted = await CouponsRepository.createCoupon(payload, actorId, targetUserId, targetCategory);

  (async () => {
      try {
          if (targetUserId) {
              const u = await CouponsRepository.getUserById(targetUserId);
              if (u) await notifyUser(u, inserted, false);
          } 
          else if (targetCategory) {
              const targetUsers = await filterUsersByCategory(targetCategory);
              for (const u of targetUsers) await notifyUser(u, inserted, false);
          }
      } catch (notificationErr) { console.error("❌ Notification Failure:", notificationErr); }
  })();

  return inserted;
};

export const updateCoupon = async (id, payload, actorId, targetUserId, targetCategory) => {
  const updated = await CouponsRepository.updateCoupon(id, payload, actorId);

  (async () => {
      try {
          if (targetUserId) {
              const u = await CouponsRepository.getUserById(targetUserId);
              if (u) await notifyUser(u, updated, true);
          } 
          else if (targetCategory) {
              const targetUsers = await filterUsersByCategory(targetCategory);
              for (const u of targetUsers) await notifyUser(u, updated, true);
          }
      } catch (notificationErr) { console.error("❌ Notification Failure:", notificationErr); }
  })();

  return updated;
};

export const deleteCoupon = async (id, actorId) => {
  return await CouponsRepository.deleteCoupon(id, actorId);
};

export const validateCoupon = async (code, userId) => {
  const coupon = await CouponsRepository.getCouponByCode(code);

  if (!coupon) throw new Error("Coupon not found");
  if (!coupon.isActive) throw new Error("This coupon is currently inactive.");
  if (coupon.isAutomatic) throw new Error("This offer is applied automatically.");

  if (coupon.targetUserId && coupon.targetUserId !== userId) {
    throw new Error("This coupon is not valid for your account.");
  }

  if (coupon.targetCategory) {
      const user = await CouponsRepository.getUserWithOrders(userId);
      if (!user) throw new Error("User not found.");

      if (!userMatchesSegment(user, user.orders || [], coupon.targetCategory)) {
          throw new Error("You do not meet eligibility criteria.");
      }
  }

  const now = new Date();
  if (coupon.validFrom && now < new Date(coupon.validFrom)) throw new Error("Not yet valid");
  if (coupon.validUntil && now > new Date(coupon.validUntil)) throw new Error("Expired");

  if (coupon.totalUsageLimit !== null) {
      const totalRedemptions = await CouponsRepository.getCompletedRedemptionsCount(coupon.id);
      if (totalRedemptions >= coupon.totalUsageLimit) {
          throw new Error("Global usage limit reached for this coupon.");
      }
  }

  if (coupon.firstOrderOnly) {
    const userOrders = await CouponsRepository.getUserOrders(userId);
    const realOrders = userOrders.filter(o => o.status !== 'pending_payment' && o.status !== 'Order Cancelled');
    if (realOrders.length > 0) throw new Error("First order only");
  }

  if (coupon.maxUsagePerUser !== null) {
    const userRedemptions = await CouponsRepository.getUserCompletedRedemptionsCount(coupon.id, userId);
    if (userRedemptions >= coupon.maxUsagePerUser) {
      throw new Error("Usage limit reached");
    }
  }

  return coupon;
};

export const getAvailableCoupons = async (userId) => {
  const now = new Date();
  let userData = null;
  let userRedemptionsMap = {}; 
  let realOrders = [];

  if (userId) {
      userData = await CouponsRepository.getUserWithOrders(userId);

      if (userData) {
        realOrders = (userData.orders || []).filter(
          o => o.status !== 'pending_payment' && o.status !== 'Order Cancelled'
        );
      }

      userRedemptionsMap = await CouponsRepository.getUserCompletedRedemptionsMap(userId);
  }

  const allCoupons = await CouponsRepository.getActiveCouponsForUserScope(userId);

  const availableCoupons = allCoupons.filter((coupon) => {
    if (coupon.targetCategory) {
        if (!userData) return false;
        if (!userMatchesSegment(userData, userData.orders || [], coupon.targetCategory)) return false;
    }
    
    const usageCount = userRedemptionsMap[coupon.id] || 0;
    if (coupon.maxUsagePerUser !== null && usageCount >= coupon.maxUsagePerUser) return false;
    if (coupon.validFrom && now < new Date(coupon.validFrom)) return false;
    if (coupon.validUntil && now > new Date(coupon.validUntil)) return false;
    if (coupon.firstOrderOnly && userData && realOrders.length > 0) return false;
    
    return true;
  });

  return availableCoupons;
};

export const getAutomaticOffers = async (userId) => {
  return await CouponsRepository.getAutomaticOffers(userId);
};
