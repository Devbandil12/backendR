import { db } from '../../db/client.js';
import {
  ordersTable,
  productsTable,
  orderItemsTable,
  UserAddressTable,
  productVariantsTable,
  productBundlesTable,
  addToCartTable,
  usersTable,
  walletTransactionsTable,
  orderTimeline,
  couponRedemptionsTable,
  couponsTable,
  otpVerificationsTable,
  verifiedPhonesTable
} from '../../db/schema/index.js';
import { eq, sql, and, inArray, gte, desc } from 'drizzle-orm'; 

export const getNextInvoiceNumber = async (tx) => {
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;
  
  const [lastOrder] = await tx.select({ invoiceNumber: ordersTable.invoiceNumber })
    .from(ordersTable)
    .where(sql`${ordersTable.invoiceNumber} LIKE ${prefix + '%'}`)
    .orderBy(desc(ordersTable.invoiceNumber))
    .limit(1);

  let nextSeq = 1;
  if (lastOrder?.invoiceNumber) {
    const parts = lastOrder.invoiceNumber.split('-');
    if (parts.length === 3) {
      nextSeq = parseInt(parts[2], 10) + 1;
    }
  }
  return `${prefix}${String(nextSeq).padStart(5, '0')}`;
};

export const lockAndGetCoupon = async (tx, couponId) => {
  const [lockedCoupon] = await tx
    .select()
    .from(couponsTable)
    .where(eq(couponsTable.id, couponId))
    .for('update');
  return lockedCoupon;
};

export const getCompletedCouponRedemptionsCount = async (tx, couponId) => {
  const totalCompleted = await tx.select().from(couponRedemptionsTable).where(
    and(
      eq(couponRedemptionsTable.couponId, couponId),
      eq(couponRedemptionsTable.status, 'completed')
    )
  );
  return totalCompleted.length;
};

export const getUserCompletedCouponRedemptionsCount = async (tx, couponId, userId) => {
  const userCompleted = await tx.select().from(couponRedemptionsTable).where(
    and(
      eq(couponRedemptionsTable.couponId, couponId),
      eq(couponRedemptionsTable.userId, userId),
      eq(couponRedemptionsTable.status, 'completed')
    )
  );
  return userCompleted.length;
};

export const deductWalletBalance = async (tx, userId, amount) => {
  const [updated] = await tx
    .update(usersTable)
    .set({ walletBalance: sql`${usersTable.walletBalance} - ${amount}` })
    .where(and(
      eq(usersTable.id, userId),
      gte(usersTable.walletBalance, amount)
    ))
    .returning();
  return updated;
};

export const getOrderForShiprocketSync = async (orderId) => {
  return await db.query.ordersTable.findFirst({
    where: eq(ordersTable.id, orderId),
    with: {
      user: true,
      address: true,
      orderItems: {
        with: {
          variant: true,
          product: true
        }
      }
    }
  });
};

export const updateOrderShiprocketIds = async (orderId, srOrderId, shipmentId) => {
  await db.update(ordersTable)
    .set({
      shiprocketOrderId: String(srOrderId),
      shiprocketShipmentId: String(shipmentId),
      updatedAt: new Date()
    })
    .where(eq(ordersTable.id, orderId));
};

export const getVariantStock = async (variantId, txOrDb = db) => {
  const [variant] = await txOrDb
      .select({ stock: productVariantsTable.stock, name: productVariantsTable.name, size: productVariantsTable.size, oprice: productVariantsTable.oprice, discount: productVariantsTable.discount, sku: productVariantsTable.sku })
      .from(productVariantsTable)
      .where(eq(productVariantsTable.id, variantId));
  return variant;
};

export const getProductSummary = async (productId) => {
  const [product] = await db
      .select({ name: productsTable.name, imageurl: productsTable.imageurl })
      .from(productsTable)
      .where(eq(productsTable.id, productId));
  return product;
};

export const getBundleContents = async (variantId, txOrDb = db) => {
  return await txOrDb
      .select()
      .from(productBundlesTable)
      .where(eq(productBundlesTable.bundleVariantId, variantId));
};

export const updateVariantStockAndSold = async (tx, variantId, qty) => {
  const [updated] = await tx.update(productVariantsTable)
      .set({
        stock: sql`${productVariantsTable.stock} - ${qty}`,
        sold: sql`${productVariantsTable.sold} + ${qty}`
      })
      .where(and(
        eq(productVariantsTable.id, variantId),
        gte(productVariantsTable.stock, qty)
      ))
      .returning({ productId: productVariantsTable.productId });
  return updated;
};

export const getUserByClerkId = async (clerkId) => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
  return user;
};

export const getUserById = async (userId) => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  return user;
};

export const getCartItemsByUser = async (userId) => {
  return await db.select().from(addToCartTable).where(eq(addToCartTable.userId, userId));
};

export const getAddressById = async (addressId) => {
  const [address] = await db.select().from(UserAddressTable).where(eq(UserAddressTable.id, addressId));
  return address;
};

export const getOtpTokenRecord = async (token) => {
  const [record] = await db.select().from(otpVerificationsTable)
      .where(eq(otpVerificationsTable.verificationToken, token));
  return record;
};

export const getVerifiedPhone = async (userId, phone) => {
  const [record] = await db.select().from(verifiedPhonesTable)
      .where(and(eq(verifiedPhonesTable.userId, userId), eq(verifiedPhonesTable.phone, phone)));
  return record;
};

export const executeTransaction = async (callback) => {
  return await db.transaction(callback);
};

export const insertOrder = async (tx, orderData) => {
  const [inserted] = await tx.insert(ordersTable).values(orderData).returning();
  return inserted;
};

export const updateOrder = async (tx, orderId, orderData) => {
  const [updated] = await tx.update(ordersTable).set(orderData).where(eq(ordersTable.id, orderId)).returning();
  return updated;
};

export const getOrderByIdLocked = async (tx, orderId) => {
  const [order] = await tx.select().from(ordersTable).where(eq(ordersTable.id, orderId)).for('update');
  return order;
};

export const getOrderByRazorpayId = async (razorpayOrderId) => {
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.razorpay_order_id, razorpayOrderId));
  return order;
};

export const markOtpTokenConsumed = async (tx, tokenId) => {
  await tx.update(otpVerificationsTable)
      .set({ tokenConsumed: true })
      .where(eq(otpVerificationsTable.id, tokenId));
};

export const insertCouponRedemption = async (tx, redemptionData) => {
  await tx.insert(couponRedemptionsTable).values(redemptionData);
};

export const updateCouponRedemptionStatus = async (tx, orderId, status) => {
  await tx.update(couponRedemptionsTable)
      .set({ status })
      .where(eq(couponRedemptionsTable.orderId, orderId));
};

export const insertOrderTimeline = async (tx, timelineData) => {
  await tx.insert(orderTimeline).values(timelineData);
};

export const insertWalletTransaction = async (tx, transactionData) => {
  await tx.insert(walletTransactionsTable).values(transactionData);
};

export const insertOrderItems = async (tx, items) => {
  await tx.insert(orderItemsTable).values(items);
};

export const clearCartItems = async (tx, userId, variantIds = null) => {
  if (variantIds) {
    await tx.delete(addToCartTable)
      .where(and(
        eq(addToCartTable.userId, userId),
        inArray(addToCartTable.variantId, variantIds)
      ));
  } else {
    await tx.delete(addToCartTable).where(eq(addToCartTable.userId, userId));
  }
};

export const getOrderItemsByOrderId = async (orderId) => {
  return await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, orderId));
};

export const storePaymentContact = async (orderId, razorpayContact, userId) => {
  db.update(ordersTable).set({ paymentContactPhone: razorpayContact }).where(eq(ordersTable.id, orderId))
    .catch(err => console.error('Failed to store paymentContactPhone:', err.message));
  db.insert(verifiedPhonesTable).values({ userId: userId, phone: razorpayContact })
    .onConflictDoUpdate({ target: [verifiedPhonesTable.userId, verifiedPhonesTable.phone], set: { verifiedAt: new Date() } })
    .catch(err => console.error('Failed to trust Razorpay contact phone:', err.message));
};
