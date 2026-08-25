import { db } from '../../db/client.js';
import { usersTable, ordersTable, orderItemsTable, productsTable, UserAddressTable, refundsTable, productVariantsTable } from '../../db/schema/index.js';
import { eq, asc, desc, inArray, or, ilike, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

// Legacy getAdminLogs removed in favor of audit module

export const getAllUsers = async (page = 1, limit = 20, search = '') => {
  const offset = (page - 1) * limit;
  let whereClause;
  
  if (search) {
    whereClause = or(
      ilike(usersTable.name, `%${search}%`),
      ilike(usersTable.email, `%${search}%`)
    );
  }

  const data = await db.query.usersTable.findMany({
    where: whereClause,
    limit: limit,
    offset: offset,
    orderBy: [desc(usersTable.id)], // Assuming order by id if createdAt not guaranteed
    with: { orders: { with: { orderItems: true } }, addresses: true },
  });

  const [{ count }] = await db.select({ count: sql`count(*)` }).from(usersTable).where(whereClause);

  return {
    data,
    meta: {
      totalCount: Number(count),
      totalPages: Math.ceil(Number(count) / limit),
      currentPage: Number(page)
    }
  };
};

export const getUserByClerkId = async (clerkId) => {
  return await db.query.usersTable.findFirst({
    where: eq(usersTable.clerkId, clerkId),
  });
};

export const getUserByClerkIdOrEmail = async (clerkId, email) => {
  return await db.query.usersTable.findFirst({
    where: or(eq(usersTable.clerkId, clerkId), eq(usersTable.email, email)),
  });
};

export const getUserById = async (id) => {
  return await db.query.usersTable.findFirst({ where: eq(usersTable.id, id) });
};

export const insertUser = async (data) => {
  const [newUser] = await db.insert(usersTable).values(data).returning();
  return newUser;
};

// Legacy insertActivityLog removed. Use audit.log() instead.

export const updateUser = async (id, data) => {
  const [updatedUser] = await db.update(usersTable).set(data).where(eq(usersTable.id, id)).returning();
  return updatedUser;
};

export const deleteUser = async (id) => {
  await db.delete(usersTable).where(eq(usersTable.id, id));
};

// Legacy getUserLogs removed. User logs should be queried via the audit module.

export const getUserAddresses = async (userId) => {
  return await db.select().from(UserAddressTable).where(eq(UserAddressTable.userId, userId));
};

export const getUserOrders = async (userId) => {
  return await db.select({
    phone: ordersTable.phone,
    orderId: ordersTable.id,
    userId: ordersTable.userId,
    userName: usersTable.name,
    email: usersTable.email,
    paymentMode: ordersTable.paymentMode,
    totalAmount: ordersTable.totalAmount,
    paymentStatus: ordersTable.paymentStatus,
    transactionId: ordersTable.transactionId,
    status: ordersTable.status,
    progressStep: ordersTable.progressStep,
    createdAt: ordersTable.createdAt,
    address: UserAddressTable.address,
    city: UserAddressTable.city,
    state: UserAddressTable.state,
    zip: UserAddressTable.postalCode,
    country: UserAddressTable.country,
  })
  .from(ordersTable)
  .innerJoin(usersTable, eq(ordersTable.userId, usersTable.id))
  .leftJoin(UserAddressTable, eq(ordersTable.userAddressId, UserAddressTable.id))
  .where(eq(ordersTable.userId, userId))
  .orderBy(asc(ordersTable.createdAt));
};

export const getOrderRefunds = async (orderIds) => {
  if (!orderIds || !orderIds.length) return [];
  return await db.select({
    id: refundsTable.id,
    orderId: refundsTable.orderId,
    amount: refundsTable.amount,
    refundStatus: refundsTable.refundStatus,
    refundSpeed: refundsTable.refundSpeed,
    gatewayRefundId: refundsTable.gatewayRefundId,
    reason: refundsTable.reason,
    createdAt: refundsTable.createdAt,
    completedAt: refundsTable.completedAt,
  })
  .from(refundsTable)
  .where(inArray(refundsTable.orderId, orderIds))
  .orderBy(asc(refundsTable.createdAt));
};

export const getOrderItems = async (orderIds) => {
  if (!orderIds || !orderIds.length) return [];
  return await db.select({
    orderId: orderItemsTable.orderId,
    productId: orderItemsTable.productId,
    variantId: orderItemsTable.variantId,
    price: orderItemsTable.price,
    quantity: orderItemsTable.quantity,
    productName: productsTable.name,
    productImage: productsTable.imageurl,
    variantName: productVariantsTable.name,
    variantSize: productVariantsTable.size,
  })
  .from(orderItemsTable)
  .innerJoin(productsTable, eq(orderItemsTable.productId, productsTable.id))
  .leftJoin(productVariantsTable, eq(orderItemsTable.variantId, productVariantsTable.id))
  .where(inArray(orderItemsTable.orderId, orderIds));
};
