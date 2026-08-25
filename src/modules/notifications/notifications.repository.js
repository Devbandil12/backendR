import { db } from '../../db/client.js';
import { notificationsTable, usersTable, UserAddressTable, addToCartTable, productVariantsTable, productsTable } from '../../db/schema/index.js';
import { eq, and, sql, desc, inArray } from 'drizzle-orm';

export const getUserByClerkId = async (clerkId) => {
  return await db.query.usersTable.findFirst({
    where: eq(usersTable.clerkId, clerkId),
    columns: { id: true, role: true }
  });
};

export const getUserById = async (userId) => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  return user;
};

export const getUserNotifications = async (userId) => {
  return await db.query.notificationsTable.findMany({
    where: eq(notificationsTable.userId, userId),
    orderBy: [desc(notificationsTable.createdAt)],
    limit: 20,
  });
};

export const getUnreadNotificationCount = async (userId) => {
  const unreadResult = await db.select({
    count: sql`count(*)::int`
  })
  .from(notificationsTable)
  .where(and(
    eq(notificationsTable.userId, userId),
    eq(notificationsTable.isRead, false)
  ));
  return unreadResult[0].count;
};

export const markNotificationsAsRead = async (userId) => {
  await db.update(notificationsTable)
    .set({ isRead: true })
    .where(and(
      eq(notificationsTable.userId, userId),
      eq(notificationsTable.isRead, false)
    ));
};

export const clearNotifications = async (userId) => {
  await db.delete(notificationsTable).where(eq(notificationsTable.userId, userId));
};

export const updatePushSubscription = async (userId, subscription) => {
  await db.update(usersTable).set({ pushSubscription: subscription }).where(eq(usersTable.id, userId));
};

export const getAddressById = async (addressId) => {
  const [addr] = await db.select().from(UserAddressTable).where(eq(UserAddressTable.id, addressId));
  return addr;
};

export const getVariantsByIds = async (variantIds) => {
  return await db.select({ id: productVariantsTable.id, oprice: productVariantsTable.oprice })
    .from(productVariantsTable)
    .where(inArray(productVariantsTable.id, variantIds));
};

export const getCartItemsByUserId = async (userId) => {
  return await db.select({
    productName: productsTable.name,
    img: productsTable.imageurl,
    size: productVariantsTable.size,
    price: productVariantsTable.oprice,
    quantity: addToCartTable.quantity
  })
  .from(addToCartTable)
  .innerJoin(productVariantsTable, eq(addToCartTable.variantId, productVariantsTable.id))
  .innerJoin(productsTable, eq(productVariantsTable.productId, productsTable.id))
  .where(eq(addToCartTable.userId, userId));
};

export const insertNotification = async (data) => {
  await db.insert(notificationsTable).values(data);
};
