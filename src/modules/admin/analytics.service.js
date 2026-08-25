
import { db } from "../../db/client.js";
import {
  ordersTable, usersTable,
  productsTable, orderItemsTable, productVariantsTable,
} from "../../db/schema/index.js";
import { eq, and, gte, lte, sql, inArray, isNotNull } from "drizzle-orm";
import { resolvePeriod as getDateRange } from '../analytics/analyticsPeriod.js';

// ── Date Logic (Shared with Admin Service) ────────────────────────────────────

const calculateTrend = (current, prev) => {
  if (!prev || prev === 0) return current > 0 ? 100 : 0;
  return ((current - prev) / prev) * 100;
};

// Valid Revenue Orders condition
const isRevenueOrderSQL = sql`(
  (${ordersTable.status} != 'Order Cancelled') 
  AND 
  (
    ((${ordersTable.paymentMode} = 'online' OR ${ordersTable.paymentMode} = 'wallet') AND ${ordersTable.paymentStatus} = 'paid') 
    OR 
    ((${ordersTable.paymentMode} = 'cod' OR ${ordersTable.paymentMode} = 'cash') AND ${ordersTable.status} = 'Delivered')
  )
)`;

export class AnalyticsService {
  
  static async getSalesAnalytics(timeRange, customStartDate, customEndDate) {
    const { current, previous, hasTrend, comparisonLabel } = getDateRange(timeRange, customStartDate, customEndDate);

    // 1. Current Period KPIs
    const [currentOrders, currentRefundsResult] = await Promise.all([
      db.select({
        revenue: sql`SUM(${ordersTable.totalAmount} + COALESCE(${ordersTable.walletAmountUsed}, 0))`,
        orders: sql`COUNT(DISTINCT ${ordersTable.id})`,
        discounts: sql`SUM(COALESCE(${ordersTable.discountAmount}, 0) + COALESCE(${ordersTable.offerDiscount}, 0))`
      }).from(ordersTable)
        .where(and(
          gte(ordersTable.createdAt, current.start),
          lte(ordersTable.createdAt, current.end),
          isRevenueOrderSQL
        )),
      db.execute(sql`
        SELECT COALESCE(SUM(amount), 0)::bigint as "totalRefundsPaise"
        FROM refunds
        WHERE created_at >= ${current.start} AND created_at <= ${current.end} AND refund_status = 'processed'
      `)
    ]);

    // Calculate costs by joining order_items and product_variants
    const currentCosts = await db.select({
      totalCost: sql`SUM(${orderItemsTable.quantity} * COALESCE(${productVariantsTable.costPrice}, 0))`
    }).from(orderItemsTable)
      .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
      .leftJoin(productVariantsTable, eq(orderItemsTable.variantId, productVariantsTable.id))
      .where(and(
        gte(ordersTable.createdAt, current.start),
        lte(ordersTable.createdAt, current.end),
        isRevenueOrderSQL
      ));

    // Cancellation Rate
    const currentTotalAttempted = await db.select({ count: sql`COUNT(*)` })
      .from(ordersTable)
      .where(and(
        gte(ordersTable.createdAt, current.start),
        lte(ordersTable.createdAt, current.end)
      ));
    
    const currentCancelled = await db.select({ count: sql`COUNT(*)` })
      .from(ordersTable)
      .where(and(
        gte(ordersTable.createdAt, current.start),
        lte(ordersTable.createdAt, current.end),
        eq(ordersTable.status, 'Order Cancelled')
      ));

    // 2. Previous Period KPIs (for trends)
    let prevRev = 0, prevOrd = 0, prevCost = 0, prevRefunds = 0, prevDisc = 0;
    
    if (hasTrend) {
      const [prevOrders, prevRefundsResult, prevCosts] = await Promise.all([
        db.select({
          revenue: sql`SUM(${ordersTable.totalAmount} + COALESCE(${ordersTable.walletAmountUsed}, 0))`,
          orders: sql`COUNT(DISTINCT ${ordersTable.id})`,
          discounts: sql`SUM(COALESCE(${ordersTable.discountAmount}, 0) + COALESCE(${ordersTable.offerDiscount}, 0))`
        }).from(ordersTable)
          .where(and(
            gte(ordersTable.createdAt, previous.start),
            lte(ordersTable.createdAt, previous.end),
            isRevenueOrderSQL
          )),
        db.execute(sql`
          SELECT COALESCE(SUM(amount), 0)::bigint as "totalRefundsPaise"
          FROM refunds
          WHERE created_at >= ${previous.start} AND created_at <= ${previous.end} AND refund_status = 'processed'
        `),
        db.select({
          totalCost: sql`SUM(${orderItemsTable.quantity} * COALESCE(${productVariantsTable.costPrice}, 0))`
        }).from(orderItemsTable)
          .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
          .leftJoin(productVariantsTable, eq(orderItemsTable.variantId, productVariantsTable.id))
          .where(and(
            gte(ordersTable.createdAt, previous.start),
            lte(ordersTable.createdAt, previous.end),
            isRevenueOrderSQL
          ))
      ]);

      prevRev = Number(prevOrders[0]?.revenue || 0);
      prevOrd = Number(prevOrders[0]?.orders || 0);
      prevRefunds = Number(prevRefundsResult.rows[0]?.totalRefundsPaise || 0) / 100;
      prevDisc = Number(prevOrders[0]?.discounts || 0);
      prevCost = Number(prevCosts[0]?.totalCost || 0);
    }

    // Process Current
    const revenue = Number(currentOrders[0]?.revenue || 0);
    const orders = Number(currentOrders[0]?.orders || 0);
    const refunds = Number(currentRefundsResult.rows[0]?.totalRefundsPaise || 0) / 100;
    const discounts = Number(currentOrders[0]?.discounts || 0);
    const cost = Number(currentCosts[0]?.totalCost || 0);
    const profit = revenue - cost;
    const aov = orders > 0 ? revenue / orders : 0;
    
    const totalAttempted = Number(currentTotalAttempted[0]?.count || 0);
    const totalCancelled = Number(currentCancelled[0]?.count || 0);
    const cancellationRate = totalAttempted > 0 ? (totalCancelled / totalAttempted) * 100 : 0;

    const prevProfit = prevRev - prevCost;
    const prevAov = prevOrd > 0 ? prevRev / prevOrd : 0;

    // 3. Time Series Data
    const timeSeriesData = await db.execute(sql`
      SELECT 
        TO_CHAR(o.created_at, 'YYYY-MM-DD') as date,
        SUM(o.total_amount + COALESCE(o.wallet_amount_used, 0)) as revenue,
        COUNT(DISTINCT o.id) as orders
      FROM ${ordersTable} o
      WHERE o.created_at >= ${current.start} 
        AND o.created_at <= ${current.end}
        AND (
          (o.status != 'Order Cancelled') AND 
          (
            ((o.payment_mode = 'online' OR o.payment_mode = 'wallet') AND o.payment_status = 'paid') 
            OR 
            ((o.payment_mode = 'cod' OR o.payment_mode = 'cash') AND o.status = 'Delivered')
          )
        )
      GROUP BY TO_CHAR(o.created_at, 'YYYY-MM-DD')
      ORDER BY TO_CHAR(o.created_at, 'YYYY-MM-DD') ASC
    `);

    // 4. Sales Table Data (Detailed orders)
    const recentOrders = await db.select({
      id: ordersTable.id,
      date: ordersTable.createdAt,
      revenue: sql`(${ordersTable.totalAmount} + COALESCE(${ordersTable.walletAmountUsed}, 0))`,
      paymentMode: ordersTable.paymentMode,
      status: ordersTable.status
    }).from(ordersTable)
      .where(and(
        gte(ordersTable.createdAt, current.start),
        lte(ordersTable.createdAt, current.end)
      ))
      .orderBy(sql`${ordersTable.createdAt} DESC`)
      .limit(100);

    return {
      kpis: {
        revenue,
        revenueTrend: calculateTrend(revenue, prevRev),
        profit,
        profitTrend: calculateTrend(profit, prevProfit),
        orders,
        ordersTrend: calculateTrend(orders, prevOrd),
        aov,
        aovTrend: calculateTrend(aov, prevAov),
        refunds,
        refundsTrend: calculateTrend(refunds, prevRefunds),
        discounts,
        discountsTrend: calculateTrend(discounts, prevDisc),
        cancellationRate,
      },
      chartData: timeSeriesData.rows || timeSeriesData || [],
      tableData: recentOrders,
      hasTrend,
      comparisonLabel
    };
  }

  static async getCustomerAnalytics(timeRange, customStartDate, customEndDate) {
    const { current, previous, hasTrend, comparisonLabel } = getDateRange(timeRange, customStartDate, customEndDate);

    const newUsers = await db.select({ count: sql`COUNT(*)` })
      .from(usersTable)
      .where(and(
        gte(usersTable.createdAt, current.start),
        lte(usersTable.createdAt, current.end)
      ));

    const repeatCustomersQuery = await db.execute(sql`
      SELECT COUNT(*) as count FROM (
        SELECT user_id 
        FROM ${ordersTable}
        WHERE created_at <= ${current.end}
        GROUP BY user_id
        HAVING COUNT(id) > 1
      ) as repeat_users
    `);

    const activeCustomersQuery = await db.execute(sql`
      SELECT COUNT(DISTINCT user_id) as count 
      FROM ${ordersTable}
      WHERE created_at >= ${current.start} AND created_at <= ${current.end}
    `);

    const topCustomersQuery = await db.execute(sql`
      SELECT 
        u.id, u.name, u.email,
        COUNT(o.id) as total_orders,
        SUM(o.total_amount + COALESCE(o.wallet_amount_used, 0)) as total_spent
      FROM ${ordersTable} o
      JOIN ${usersTable} u ON o.user_id = u.id
      WHERE o.created_at >= ${current.start} AND o.created_at <= ${current.end}
        AND (
          (o.status != 'Order Cancelled') AND 
          (
            ((o.payment_mode = 'online' OR o.payment_mode = 'wallet') AND o.payment_status = 'paid') 
            OR 
            ((o.payment_mode = 'cod' OR o.payment_mode = 'cash') AND o.status = 'Delivered')
          )
        )
      GROUP BY u.id, u.name, u.email
      ORDER BY total_spent DESC
      LIMIT 100
    `);

    return {
      kpis: {
        newCustomers: Number(newUsers[0]?.count || 0),
        activeCustomers: Number((activeCustomersQuery.rows?.[0] || activeCustomersQuery[0])?.count || 0),
        repeatCustomers: Number((repeatCustomersQuery.rows?.[0] || repeatCustomersQuery[0])?.count || 0)
      },
      topCustomers: topCustomersQuery.rows || topCustomersQuery || [],
      hasTrend,
      comparisonLabel
    };
  }

  static async getProductAnalytics(timeRange, customStartDate, customEndDate) {
    const { current, previous, hasTrend, comparisonLabel } = getDateRange(timeRange, customStartDate, customEndDate);

    const productPerformance = await db.execute(sql`
      SELECT 
        p.id as product_id,
        p.name as product_name,
        SUM(oi.quantity) as units_sold,
        SUM(oi.total_price) as revenue,
        SUM(oi.total_price - (oi.quantity * COALESCE(v.cost_price, 0))) as profit
      FROM ${orderItemsTable} oi
      JOIN ${ordersTable} o ON oi.order_id = o.id
      JOIN ${productsTable} p ON oi.product_id = p.id
      LEFT JOIN ${productVariantsTable} v ON oi.variant_id = v.id
      WHERE o.created_at >= ${current.start} AND o.created_at <= ${current.end}
        AND (
          (o.status != 'Order Cancelled') AND 
          (
            ((o.payment_mode = 'online' OR o.payment_mode = 'wallet') AND o.payment_status = 'paid') 
            OR 
            ((o.payment_mode = 'cod' OR o.payment_mode = 'cash') AND o.status = 'Delivered')
          )
        )
      GROUP BY p.id, p.name
      ORDER BY revenue DESC
      LIMIT 50
    `);

    return {
      products: productPerformance.rows || productPerformance || [],
      hasTrend,
      comparisonLabel
    };
  }

  static async getInventoryAnalytics() {
    const inventory = await db.execute(sql`
      SELECT 
        p.name as product_name,
        v.name as variant_name,
        v.sku,
        v.stock,
        v.sold,
        v.oprice as price,
        (v.stock * v.oprice) as potential_revenue,
        CASE WHEN (v.stock + v.sold) > 0 THEN (v.sold::float / (v.stock + v.sold)) * 100 ELSE 0 END as turnover_rate
      FROM ${productVariantsTable} v
      JOIN ${productsTable} p ON v.product_id = p.id
      WHERE v.is_archived = false
      ORDER BY v.stock ASC
    `);

    const rows = inventory.rows || inventory || [];

    let totalValue = 0, lowStockCount = 0, outOfStockCount = 0;
    rows.forEach(r => {
      totalValue += Number(r.potential_revenue);
      if (r.stock === 0) outOfStockCount++;
      else if (r.stock < 10) lowStockCount++;
    });

    return {
      kpis: { totalValue, lowStockCount, outOfStockCount, totalVariants: rows.length },
      tableData: rows
    };
  }
}
