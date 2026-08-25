import { db } from '../../db/client.js';
import { 
  ordersTable, 
  usersTable, 
  productsTable, 
  orderItemsTable, 
  wishlistTable,
  reviewsTable,
  productVariantsTable
} from '../../db/schema/index.js';
import { eq, and, gte, lte, sql, count, countDistinct, sum, desc, isNotNull } from 'drizzle-orm';

export const getWishlistCount = async (startDate, endDate) => {
  const [{ total }] = await db
    .select({ total: count(wishlistTable.id) })
    .from(wishlistTable)
    .where(
      and(
        gte(wishlistTable.addedAt, startDate),
        lte(wishlistTable.addedAt, endDate)
      )
    );
  return Number(total);
};

export const getOrdersCount = async (startDate, endDate) => {
  const [{ total }] = await db
    .select({ total: count(ordersTable.id) })
    .from(ordersTable)
    .where(
      and(
        gte(ordersTable.createdAt, startDate),
        lte(ordersTable.createdAt, endDate)
      )
    );
  return Number(total);
};

export const getAverageRating = async (startDate, endDate) => {
  const [{ avg, total }] = await db
    .select({ 
      avg: sql`AVG(${reviewsTable.rating})`,
      total: count(reviewsTable.id)
    })
    .from(reviewsTable)
    .where(
      and(
        gte(reviewsTable.createdAt, startDate),
        lte(reviewsTable.createdAt, endDate)
      )
    );
  return { avg: Number(avg || 0), count: Number(total) };
};

export const getReturnStats = async (startDate, endDate) => {
  const [{ totalOrders }] = await db
    .select({ totalOrders: count(ordersTable.id) })
    .from(ordersTable)
    .where(
      and(
        gte(ordersTable.createdAt, startDate),
        lte(ordersTable.createdAt, endDate)
      )
    );

  const [{ totalReturns }] = await db
    .select({ totalReturns: count(ordersTable.id) })
    .from(ordersTable)
    .where(
      and(
        gte(ordersTable.createdAt, startDate),
        lte(ordersTable.createdAt, endDate),
        sql`${ordersTable.status} = 'returned'`
      )
    );

  return { totalOrders: Number(totalOrders), totalReturns: Number(totalReturns) };
};

export const getProductSignals = async (startDate, endDate) => {
  // Aggregate sales and wishlists by product
  const sales = await db
    .select({
      productId: orderItemsTable.productId,
      sales: count(orderItemsTable.id)
    })
    .from(orderItemsTable)
    .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
    .where(
      and(
        gte(ordersTable.createdAt, startDate),
        lte(ordersTable.createdAt, endDate)
      )
    )
    .groupBy(orderItemsTable.productId);

  const wishlists = await db
    .select({
      productId: productVariantsTable.productId,
      wishlists: count(wishlistTable.id)
    })
    .from(wishlistTable)
    .innerJoin(productVariantsTable, eq(wishlistTable.variantId, productVariantsTable.id))
    .where(
      and(
        gte(wishlistTable.addedAt, startDate),
        lte(wishlistTable.addedAt, endDate)
      )
    )
    .groupBy(productVariantsTable.productId);
    
  return { sales, wishlists };
};

export const getProductsWithStock = async () => {
  const products = await db
    .select({
      id: productsTable.id,
      name: productsTable.name,
      stock: sql`SUM(${productVariantsTable.stock})`
    })
    .from(productsTable)
    .leftJoin(productVariantsTable, eq(productsTable.id, productVariantsTable.productId))
    .groupBy(productsTable.id, productsTable.name);
    
  return products.map(p => ({ ...p, stock: Number(p.stock || 0) }));
};

export const getPaymentStats = async (startDate, endDate) => {
  const [{ codOrders, onlineOrders, codRto, onlineFailed }] = await db
    .select({
      codOrders: sum(sql`CASE WHEN ${ordersTable.paymentMode} = 'cod' THEN 1 ELSE 0 END`),
      onlineOrders: sum(sql`CASE WHEN ${ordersTable.paymentMode} = 'online' THEN 1 ELSE 0 END`),
      codRto: sum(sql`CASE WHEN ${ordersTable.paymentMode} = 'cod' AND ${ordersTable.status} = 'cancelled' THEN 1 ELSE 0 END`),
      onlineFailed: sum(sql`CASE WHEN ${ordersTable.paymentMode} = 'online' AND ${ordersTable.paymentStatus} != 'success' THEN 1 ELSE 0 END`)
    })
    .from(ordersTable)
    .where(
      and(
        gte(ordersTable.createdAt, startDate),
        lte(ordersTable.createdAt, endDate)
      )
    );

  return {
    codOrders: Number(codOrders || 0),
    onlineOrders: Number(onlineOrders || 0),
    codRto: Number(codRto || 0),
    onlineFailed: Number(onlineFailed || 0)
  };
};
