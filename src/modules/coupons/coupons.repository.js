import { db } from "../../db/client.js";
import { 
    couponsTable, 
    ordersTable, 
    usersTable, 
    notificationsTable,
    couponRedemptionsTable 
} from "../../db/schema/index.js";
import { eq, and, isNull, gte, lte, or } from "drizzle-orm";
import { audit } from "../../infrastructure/audit/audit.service.js";
import { ACTOR_TYPES } from "../../infrastructure/audit/audit.constants.js";

export const getAllCoupons = async () => {
  return await db.select().from(couponsTable);
};

export const createCoupon = async (payload, actorId, targetUserId, targetCategory) => {
  const [inserted] = await db.insert(couponsTable).values(payload).returning();
  
  if (actorId) {
    let desc = `Created coupon: ${inserted.code}`;
    if (targetUserId) desc += ' (Targeted User)';
    if (targetCategory) desc += ` (Targeted Category: ${targetCategory})`;

    await audit.log({
        actorUserId: actorId,
        actorType: ACTOR_TYPES.ADMIN,
        action: 'COUPON_CREATED',
        resourceType: 'COUPON',
        resourceId: inserted.id,
        resourceData: inserted,
        description: desc
    });
  }
  return inserted;
};

export const getCouponByCode = async (code) => {
  const [coupon] = await db.select().from(couponsTable).where(eq(couponsTable.code, code));
  return coupon;
};

export const getCompletedRedemptionsCount = async (couponId) => {
  const totalRedemptions = await db.select().from(couponRedemptionsTable).where(
    and(eq(couponRedemptionsTable.couponId, couponId), eq(couponRedemptionsTable.status, 'completed'))
  );
  return totalRedemptions.length;
};

export const getUserCompletedRedemptionsCount = async (couponId, userId) => {
  const userRedemptions = await db.select().from(couponRedemptionsTable).where(
    and(
      eq(couponRedemptionsTable.couponId, couponId),
      eq(couponRedemptionsTable.userId, userId),
      eq(couponRedemptionsTable.status, 'completed')
    )
  );
  return userRedemptions.length;
};

export const getUserOrders = async (userId) => {
  return await db.select().from(ordersTable).where(eq(ordersTable.userId, userId));
};

export const getUserWithOrders = async (userId) => {
  return await db.query.usersTable.findFirst({ 
    where: eq(usersTable.id, userId), 
    with: { orders: true } 
  });
};

export const getUserCompletedRedemptionsMap = async (userId) => {
  const redemptions = await db.select().from(couponRedemptionsTable).where(
    and(eq(couponRedemptionsTable.userId, userId), eq(couponRedemptionsTable.status, 'completed'))
  );
  let map = {};
  redemptions.forEach(r => {
    map[r.couponId] = (map[r.couponId] || 0) + 1;
  });
  return map;
};

export const getActiveCouponsForUserScope = async (userId) => {
  return await db.select().from(couponsTable).where(
    and(
      eq(couponsTable.isActive, true), 
      or(isNull(couponsTable.targetUserId), eq(couponsTable.targetUserId, userId || '00000000-0000-0000-0000-000000000000'))
    )
  );
};

export const updateCoupon = async (id, payload, actorId) => {
  const [updated] = await db
    .update(couponsTable)
    .set(payload)
    .where(eq(couponsTable.id, id))
    .returning();

  if (actorId && updated) {
      await audit.log({
          actorUserId: actorId,
          actorType: ACTOR_TYPES.ADMIN,
          action: 'COUPON_UPDATED',
          resourceType: 'COUPON',
          resourceId: id,
          resourceData: updated,
          description: `Updated coupon: ${updated.code}`
      });
  }
  return updated;
};

export const deleteCoupon = async (id, actorId) => {
  const [coupon] = await db.select().from(couponsTable).where(eq(couponsTable.id, id));
  if (!coupon) return false;

  await db.delete(couponsTable).where(eq(couponsTable.id, id));

  if (actorId) {
      await audit.log({
          actorUserId: actorId,
          actorType: ACTOR_TYPES.ADMIN,
          action: 'COUPON_DELETED',
          resourceType: 'COUPON',
          resourceId: id,
          resourceData: coupon,
          description: `Deleted coupon: ${coupon.code}`,
          metadata: { code: coupon.code }
      });
  }
  return true;
};

export const getAutomaticOffers = async (userId) => {
  const now = new Date();
  
  let conditions = and(
    eq(couponsTable.isAutomatic, true),
    eq(couponsTable.isActive, true),
    or(isNull(couponsTable.validFrom), lte(couponsTable.validFrom, now)),
    or(isNull(couponsTable.validUntil), gte(couponsTable.validUntil, now))
  );

  if (userId) {
    conditions = and(conditions, or(isNull(couponsTable.targetUserId), eq(couponsTable.targetUserId, userId)));
  } else {
    conditions = and(conditions, isNull(couponsTable.targetUserId));
  }

  return await db.select().from(couponsTable).where(conditions);
};

export const getAllUsersWithOrders = async () => {
  return await db.query.usersTable.findMany({
    with: { orders: true }
  });
};

export const getUserById = async (userId) => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  return user;
};

export const insertNotification = async (userId, message, link, type) => {
  await db.insert(notificationsTable).values({
    userId,
    message,
    link,
    type,
    isRead: false,
    createdAt: new Date()
  });
};
