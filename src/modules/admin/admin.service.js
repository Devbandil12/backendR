import { db } from "../../db/client.js";
import {
  ordersTable, usersTable, addToCartTable,
  productsTable, orderItemsTable, productVariantsTable,
  ticketsTable, couponsTable, refundsTable
} from "../../db/schema/index.js";
import { eq, and, gte, lte, inArray, sql, lt, ne, isNotNull } from "drizzle-orm";

// ── Date Range ─────────────────────────────────────────────────────────────────
const getDateRange = (range, customStartDate, customEndDate) => {
  const now = new Date();
  const current = { start: new Date(now), end: new Date(now) };
  const previous = { start: new Date(now), end: new Date(now) };
  let hasTrend = true;
  let comparisonLabel = '';

  switch (range) {
    case 'today':
    case 'day':
      current.start.setHours(0, 0, 0, 0);
      previous.start = new Date(now); previous.start.setDate(now.getDate() - 1); previous.start.setHours(0, 0, 0, 0);
      previous.end = new Date(now); previous.end.setDate(now.getDate() - 1); previous.end.setHours(23, 59, 59, 999);
      comparisonLabel = 'vs yesterday';
      break;
    case 'yesterday':
      current.start = new Date(now); current.start.setDate(now.getDate() - 1); current.start.setHours(0, 0, 0, 0);
      current.end = new Date(now); current.end.setDate(now.getDate() - 1); current.end.setHours(23, 59, 59, 999);
      previous.start = new Date(now); previous.start.setDate(now.getDate() - 2); previous.start.setHours(0, 0, 0, 0);
      previous.end = new Date(now); previous.end.setDate(now.getDate() - 2); previous.end.setHours(23, 59, 59, 999);
      comparisonLabel = 'vs day before yesterday';
      break;
    case 'week':
      current.start.setDate(now.getDate() - 7);
      previous.start.setDate(now.getDate() - 14);
      previous.end.setDate(now.getDate() - 7);
      comparisonLabel = 'vs previous 7 days';
      break;
    case 'month':
      current.start.setDate(now.getDate() - 30);
      previous.start.setDate(now.getDate() - 60);
      previous.end.setDate(now.getDate() - 30);
      comparisonLabel = 'vs previous 30 days';
      break;
    case '3months':
      current.start.setDate(now.getDate() - 90);
      previous.start.setDate(now.getDate() - 180);
      previous.end.setDate(now.getDate() - 90);
      comparisonLabel = 'vs previous 90 days';
      break;
    case '6months':
      current.start.setMonth(now.getMonth() - 6);
      previous.start.setMonth(now.getMonth() - 12);
      previous.end.setMonth(now.getMonth() - 6);
      comparisonLabel = 'vs previous 6 months';
      break;
    case 'year':
      current.start.setFullYear(now.getFullYear() - 1);
      previous.start.setFullYear(now.getFullYear() - 2);
      previous.end.setFullYear(now.getFullYear() - 1);
      comparisonLabel = 'vs previous year';
      break;
    case 'custom':
      if (customStartDate && customEndDate) {
        const s = new Date(customStartDate);
        const e = new Date(customEndDate); e.setHours(23, 59, 59, 999);
        current.start = s; current.end = e;
        const diff = e.getTime() - s.getTime();
        previous.end = new Date(s.getTime() - 1);
        previous.start = new Date(previous.end.getTime() - diff);
        const days = Math.round(diff / (1000 * 60 * 60 * 24));
        comparisonLabel = `vs previous ${days} day${days !== 1 ? 's' : ''}`;
      } else {
        current.start = new Date(0); previous.start = new Date(0);
        hasTrend = false;
      }
      break;
    default:
      // 'all' is removed from the UI but handled gracefully
      current.start = new Date(0); previous.start = new Date(0);
      hasTrend = false;
      comparisonLabel = '';
  }
  return { current, previous, hasTrend, comparisonLabel };
};

// ── Chart Bucket Count ─────────────────────────────────────────────────────────
const getBucketCount = (range) => {
  switch (range) {
    case 'today': case 'day': return 24;
    case 'yesterday': return 24;
    case 'week': return 7;
    case 'month': return 30;
    case '3months': return 13;
    case '6months': return 26;
    case 'year': return 12;
    default: return 12;
  }
};

const calculateTrend = (current, prev) => {
  if (prev === 0) return current > 0 ? 100 : 0;
  return ((current - prev) / prev) * 100;
};

// ── isRevenueOrder filter ──────────────────────────────────────────────────────
const isRevenueOrder = (o) => {
  if (o.status === 'Order Cancelled') return false;
  if (o.paymentMode === 'online' || o.paymentMode === 'wallet') return o.paymentStatus === 'paid';
  if (o.paymentMode === 'cod' || o.paymentMode === 'cash') return o.status === 'Delivered';
  return false;
};

const isValidVolumeOrder = (o) => {
  const isOnlinePending = o.paymentMode === 'online' && (o.paymentStatus === 'pending' || o.paymentStatus === 'pending_payment');
  return !isOnlinePending;
};

// ─────────────────────────────────────────────────────────────────────────────
// getDashboardStats
// ─────────────────────────────────────────────────────────────────────────────
export const getDashboardStats = async (timeRange, customStartDate, customEndDate) => {
  const { current, previous, hasTrend, comparisonLabel } = getDateRange(timeRange, customStartDate, customEndDate);
  const absoluteStart = previous.start;

  // ── 1. Fetch Orders & Refunds from refundsTable ──────────────────────────────
  const [rawOrders, rawRefunds] = await Promise.all([
    db.select({
      id: ordersTable.id,
      userId: ordersTable.userId,
      userAddressId: ordersTable.userAddressId,
      status: ordersTable.status,
      totalAmount: ordersTable.totalAmount,
      walletAmountUsed: ordersTable.walletAmountUsed,
      paymentMode: ordersTable.paymentMode,
      paymentStatus: ordersTable.paymentStatus,
      createdAt: ordersTable.createdAt,
      discountAmount: ordersTable.discountAmount,
      offerDiscount: ordersTable.offerDiscount,
    }).from(ordersTable).where(gte(ordersTable.createdAt, absoluteStart)),
    db.select({
      id: refundsTable.id,
      orderId: refundsTable.orderId,
      amount: refundsTable.amount,
      refundStatus: refundsTable.refundStatus,
      createdAt: refundsTable.createdAt,
    }).from(refundsTable).where(gte(refundsTable.createdAt, absoluteStart))
  ]);

  // ── 2. Fetch Users ─────────────────────────────────────────────────────────
  const [newUsers, prevNewUsers] = await Promise.all([
    db.select({ id: usersTable.id }).from(usersTable)
      .where(and(gte(usersTable.createdAt, current.start), lte(usersTable.createdAt, current.end))),
    db.select({ id: usersTable.id }).from(usersTable)
      .where(and(gte(usersTable.createdAt, previous.start), lte(usersTable.createdAt, previous.end))),
  ]);

  // ── 3. Filter Orders ───────────────────────────────────────────────────────
  const filterByDate = (data, start, end) =>
    data.filter(item => { const d = new Date(item.createdAt); return d >= start && d <= end; });

  const rawCurrentOrders = filterByDate(rawOrders, current.start, current.end);
  const rawPrevOrders = filterByDate(rawOrders, previous.start, previous.end);
  const currentRefunds = filterByDate(rawRefunds, current.start, current.end);
  const prevRefundsList = filterByDate(rawRefunds, previous.start, previous.end);
  const currentTotalOrders = rawCurrentOrders.filter(isValidVolumeOrder);
  const successOrders = currentTotalOrders.filter(isRevenueOrder);
  const prevSuccessOrders = rawPrevOrders.filter(isValidVolumeOrder).filter(isRevenueOrder);
  const cancelledOrders = currentTotalOrders.filter(o => o.status === 'Order Cancelled');

  // ── 4. Revenue ─────────────────────────────────────────────────────────────
  const calcRevenue = (list) => list.reduce((sum, o) => sum + (parseFloat(o.totalAmount || 0)) + (parseFloat(o.walletAmountUsed || 0)), 0);
  const revenue = calcRevenue(successOrders);
  const prevRevenue = calcRevenue(prevSuccessOrders);
  const lostRevenue = calcRevenue(cancelledOrders);

  const walletUsed = successOrders.reduce((sum, o) => sum + (parseFloat(o.walletAmountUsed) || 0), 0);
  const prevWalletUsed = prevSuccessOrders.reduce((sum, o) => sum + (parseFloat(o.walletAmountUsed) || 0), 0);

  const aov = successOrders.length ? revenue / successOrders.length : 0;
  const prevAov = prevSuccessOrders.length ? prevRevenue / prevSuccessOrders.length : 0;

  // ── 5. Profit ──────────────────────────────────────────────────────────────
  let profit = 0, prevProfit = 0;
  let categoryStats = {};
  const allSuccessOrderIds = [...successOrders.map(o => o.id), ...prevSuccessOrders.map(o => o.id)];

  if (allSuccessOrderIds.length > 0) {
    const items = await db.select({
      orderId: orderItemsTable.orderId,
      // FIX: GROUP BY productId (not name) to avoid name collision
      productId: orderItemsTable.productId,
      productName: orderItemsTable.productName,
      img: orderItemsTable.img,
      quantity: orderItemsTable.quantity,
      totalPrice: orderItemsTable.totalPrice,
      costPrice: productVariantsTable.costPrice,
      category: productsTable.category,
    }).from(orderItemsTable)
      .leftJoin(productsTable, eq(orderItemsTable.productId, productsTable.id))
      .leftJoin(productVariantsTable, eq(orderItemsTable.variantId, productVariantsTable.id))
      .where(inArray(orderItemsTable.orderId, allSuccessOrderIds));

    const calcProfitForOrders = (list) => list.reduce((sum, order) => {
      const orderItems = items.filter(i => i.orderId === order.id);
      const orderCost = orderItems.reduce((pSum, p) => pSum + ((parseFloat(p.costPrice) || 0) * p.quantity), 0);
      const orderRevenue = (parseFloat(order.totalAmount || 0) + parseFloat(order.walletAmountUsed || 0));
      return sum + (orderRevenue - orderCost);
    }, 0);

    profit = calcProfitForOrders(successOrders);
    prevProfit = calcProfitForOrders(prevSuccessOrders);

    const currentSuccessIds = new Set(successOrders.map(o => o.id));
    items.forEach(p => {
      if (currentSuccessIds.has(p.orderId)) {
        const cat = p.category || 'Uncategorized';
        categoryStats[cat] = (categoryStats[cat] || 0) + p.quantity;
      }
    });
  }

  // ── 6. Customer Metrics ────────────────────────────────────────────────────
  const newCustomersCount = newUsers.length;
  const prevNewCustomersCount = prevNewUsers.length;
  const activeUserIds = [...new Set(successOrders.map(o => String(o.userId)))];
  const activeBuyersCount = activeUserIds.length;
  let returningCount = 0, firstTimeBuyersCount = 0;
  let prevReturningCount = 0;

  if (activeBuyersCount > 0) {
    const historyRes = await db.execute(sql`
      SELECT user_id, MIN(created_at) as first_date, COUNT(*) as total_count 
      FROM orders 
      WHERE user_id IN (${sql.join(activeUserIds.map(id => sql`${id}`), sql`,`)}) 
      AND status != 'Order Cancelled' 
      AND ((payment_mode IN ('online', 'wallet') AND payment_status = 'paid') OR (payment_mode IN ('cod', 'cash') AND status = 'Delivered'))
      GROUP BY user_id
    `);
    historyRes.rows.forEach(r => {
      const fd = new Date(r.first_date);
      const tc = parseInt(r.total_count);
      if (fd >= current.start) firstTimeBuyersCount++;
      if (tc > 1) returningCount++;
    });
  }

  // Previous period returning count
  if (hasTrend) {
    const prevActiveUserIds = [...new Set(prevSuccessOrders.map(o => String(o.userId)))];
    if (prevActiveUserIds.length > 0) {
      const prevHistRes = await db.execute(sql`
        SELECT user_id, COUNT(*) as total_count
        FROM orders
        WHERE user_id IN (${sql.join(prevActiveUserIds.map(id => sql`${id}`), sql`,`)})
        AND status != 'Order Cancelled'
        AND ((payment_mode IN ('online', 'wallet') AND payment_status = 'paid') OR (payment_mode IN ('cod', 'cash') AND status = 'Delivered'))
        GROUP BY user_id
      `);
      prevHistRes.rows.forEach(r => { if (parseInt(r.total_count) > 1) prevReturningCount++; });
    }
  }

  const returningRate = activeBuyersCount > 0 ? (returningCount / activeBuyersCount) * 100 : 0;

  // ── 7. Abandoned Carts — structured + time-aware ───────────────────────────
  const { getAbandonedCarts } = await import('../cart/cart.repository.js');
  const allCarts = await getAbandonedCarts();
  let abandonedVal = 0;
  const uniqueCartUsers = new Set();
  let eligibleCount = 0;
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  if (Array.isArray(allCarts)) {
    allCarts.forEach(item => {
      const { user, variant, cartItem } = item;
      if (!user || !variant || !cartItem) return;
      // FIX: Filter abandoned carts by current time range
      const addedAt = cartItem.addedAt ? new Date(cartItem.addedAt) : null;
      if (addedAt && addedAt < current.start) return;
      const price = parseFloat(variant.oprice ?? 0);
      const discount = parseFloat(variant.discount ?? 0);
      const quantity = parseInt(cartItem.quantity ?? 1);
      const itemValue = (price * (1 - discount / 100)) * quantity;
      if (!isNaN(itemValue)) abandonedVal += itemValue;
      uniqueCartUsers.add(user.id);
      if (addedAt && addedAt <= oneHourAgo) eligibleCount++;
    });
  }

  // ── 8. FIX: Low Stock Variants — real DB query ────────────────────────────
  const lowStockRows = await db.select({
    id: productVariantsTable.id,
    name: productVariantsTable.name,
    size: productVariantsTable.size,
    stock: productVariantsTable.stock,
    productName: productsTable.name,
    imageurl: productsTable.imageurl,
  }).from(productVariantsTable)
    .leftJoin(productsTable, eq(productVariantsTable.productId, productsTable.id))
    .where(and(
      lt(productVariantsTable.stock, 10),
      eq(productVariantsTable.isArchived, false),
      eq(productVariantsTable.is_active, true),
    ))
    .orderBy(productVariantsTable.stock)
    .limit(20);

  const lowStockVariants = lowStockRows.map(r => ({
    id: r.id,
    name: r.name,
    size: r.size,
    stock: r.stock,
    productName: r.productName,
    image: Array.isArray(r.imageurl) ? r.imageurl[0] : (typeof r.imageurl === 'object' && r.imageurl !== null ? Object.values(r.imageurl)[0] : r.imageurl),
  }));

  // ── 9. Order Health — counts by status ────────────────────────────────────
  const orderHealth = {
    pending: 0, processing: 0, shipped: 0, delivered: 0,
    cancelled: 0, rto: 0, returns: 0, refunds: 0,
  };
  rawCurrentOrders.forEach(o => {
    const s = (o.status || '').toLowerCase();
    if (s === 'order placed') orderHealth.pending++;
    else if (s === 'processing' || s === 'order confirmed') orderHealth.processing++;
    else if (s === 'shipped' || s === 'out for delivery') orderHealth.shipped++;
    else if (s === 'delivered') orderHealth.delivered++;
    else if (s === 'order cancelled') orderHealth.cancelled++;
    else if (s === 'rto' || s === 'return to origin') orderHealth.rto++;
    else if (s === 'return initiated' || s === 'return picked' || s === 'return delivered') orderHealth.returns++;
  });

  const pendingRefundOrderIds = new Set(
    currentRefunds.filter(r => r.refundStatus === 'pending' || r.refundStatus === 'in_progress').map(r => r.orderId)
  );
  orderHealth.refunds = pendingRefundOrderIds.size;

  // ── 10. Refunds from refundsTable (paise -> rupees) ───────────────────────
  const totalRefundsProcessed = currentRefunds.reduce((sum, r) => {
    if (r.refundStatus === 'processed') return sum + ((Number(r.amount) || 0) / 100);
    return sum;
  }, 0);
  const prevRefunds = prevRefundsList.reduce((sum, r) => {
    if (r.refundStatus === 'processed') return sum + ((Number(r.amount) || 0) / 100);
    return sum;
  }, 0);

  const rtoOrders = rawCurrentOrders.filter(o => o.status === 'RTO' || o.status === 'Return to Origin');
  const rtoRate = rawCurrentOrders.length > 0 ? (rtoOrders.length / rawCurrentOrders.length) * 100 : 0;

  const discountRevenue = successOrders.reduce((sum, o) => {
    const discount = (parseFloat(o.discountAmount) || 0) + (parseFloat(o.offerDiscount) || 0);
    return discount > 0 ? sum + (parseFloat(o.totalAmount) || 0) : sum;
  }, 0);

  // ── 11. Chart Data — improved bucket counts ────────────────────────────────
  const steps = timeRange === 'custom'
    ? Math.min(Math.round((current.end - current.start) / (1000 * 60 * 60 * 24)), 30) || 7
    : getBucketCount(timeRange);

  const chartLabels = [], chartRevenue = [];
  const chartVolume = { Delivered: [], Shipped: [], Processing: [], Cancelled: [] };
  const interval = (current.end - current.start) / steps;

  for (let i = 0; i < steps; i++) {
    const pStart = new Date(current.start.getTime() + interval * i);
    const pEnd = new Date(pStart.getTime() + interval);

    let label;
    if (timeRange === 'today' || timeRange === 'yesterday') {
      label = pStart.toLocaleTimeString('en-IN', { hour: 'numeric', hour12: true });
    } else if (timeRange === 'year') {
      label = pStart.toLocaleDateString('en-IN', { month: 'short' });
    } else if (timeRange === '3months' || timeRange === '6months') {
      label = `W${i + 1}`;
    } else {
      label = pStart.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
    }

    const revenueChunk = successOrders.filter(o => { const d = new Date(o.createdAt); return d >= pStart && d < pEnd; });
    const chunkRevenue = revenueChunk.reduce((s, o) => s + (parseFloat(o.totalAmount) || 0) + (parseFloat(o.walletAmountUsed) || 0), 0);
    const allChunk = rawCurrentOrders.filter(o => { const d = new Date(o.createdAt); return d >= pStart && d < pEnd; });

    let del = 0, shp = 0, prc = 0, can = 0;
    allChunk.forEach(o => {
      const s = (o.status || '').toLowerCase();
      if (s === 'delivered') del++;
      else if (s === 'shipped' || s === 'out for delivery') shp++;
      else if (s === 'order cancelled') can++;
      else prc++;
    });

    chartLabels.push(label);
    chartRevenue.push(chunkRevenue);
    chartVolume.Delivered.push(del);
    chartVolume.Shipped.push(shp);
    chartVolume.Processing.push(prc);
    chartVolume.Cancelled.push(can);
  }

  // Previous period chart (for comparison line)
  const prevChartRevenue = [];
  for (let i = 0; i < steps; i++) {
    const pStart = new Date(previous.start.getTime() + interval * i);
    const pEnd = new Date(pStart.getTime() + interval);
    const chunk = prevSuccessOrders.filter(o => { const d = new Date(o.createdAt); return d >= pStart && d < pEnd; });
    prevChartRevenue.push(chunk.reduce((s, o) => s + (parseFloat(o.totalAmount) || 0) + (parseFloat(o.walletAmountUsed) || 0), 0));
  }

  // ── 12. FIX: Top Products — GROUP BY productId ────────────────────────────
  let topProductsByVolume = [], topProductsByRevenue = [];
  if (successOrders.length > 0) {
    const currentSuccessIds = successOrders.map(o => String(o.id));
    const topProductsRes = await db.execute(sql`
      SELECT "product_id" as id, "product_name" as name, "img",
             SUM("quantity") as volume, SUM("total_price") as revenue
      FROM ${orderItemsTable}
      WHERE "order_id" IN (${sql.join(currentSuccessIds.map(id => sql`${id}`), sql`,`)})
      GROUP BY "product_id", "product_name", "img"
    `);
    const itemsList = topProductsRes.rows.map(r => ({
      id: r.id,
      name: r.name,
      img: r.img,
      volume: parseInt(r.volume),
      revenue: parseFloat(r.revenue),
    }));
    topProductsByVolume = [...itemsList].sort((a, b) => b.volume - a.volume).slice(0, 5);
    topProductsByRevenue = [...itemsList].sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  }

  // ── 13. Geographic Distribution ────────────────────────────────────────────
  let geoDistribution = [];
  if (successOrders.length > 0) {
    const { UserAddressTable } = await import('../../db/schema/users.schema.js');
    const userAddressIds = [...new Set(successOrders.map(o => String(o.userAddressId)).filter(Boolean))];
    if (userAddressIds.length > 0) {
      const geoRes = await db.execute(sql`
        SELECT "state", COUNT(*) as count
        FROM ${UserAddressTable}
        WHERE "id" IN (${sql.join(userAddressIds.map(id => sql`${id}`), sql`,`)})
        GROUP BY "state" ORDER BY count DESC LIMIT 5
      `);
      geoDistribution = geoRes.rows.map(r => ({ state: r.state, count: parseInt(r.count) }));
    }
  }

  // ── 14. Recent Activity Feed ───────────────────────────────────────────────
  const [recentOrders, recentUsersRaw] = await Promise.all([
    db.select({ id: ordersTable.id, createdAt: ordersTable.createdAt, totalAmount: ordersTable.totalAmount, status: ordersTable.status })
      .from(ordersTable).orderBy(sql`${ordersTable.createdAt} DESC`).limit(8),
    db.select({ id: usersTable.id, name: usersTable.name, createdAt: usersTable.createdAt })
      .from(usersTable).orderBy(sql`${usersTable.createdAt} DESC`).limit(5),
  ]);

  const activityFeed = [];
  recentOrders.forEach(o => activityFeed.push({ id: o.id, type: 'ORDER', status: o.status, message: `Order #${o.id} placed — ₹${(o.totalAmount || 0).toLocaleString('en-IN')}`, time: o.createdAt }));
  recentUsersRaw.forEach(u => activityFeed.push({ id: u.id, type: 'USER', message: `New customer registered: ${u.name || 'Guest'}`, time: u.createdAt }));
  activityFeed.sort((a, b) => new Date(b.time) - new Date(a.time));
  const recentActivity = activityFeed.slice(0, 12);

  // ── Conversion Rates ───────────────────────────────────────────────────────
  const conversionRate = currentTotalOrders.length ? (successOrders.length / currentTotalOrders.length) * 100 : 0;
  const prevConversionRate = rawPrevOrders.filter(isValidVolumeOrder).length
    ? (prevSuccessOrders.length / rawPrevOrders.filter(isValidVolumeOrder).length) * 100 : 0;

  return {
    // ── Meta ──
    hasTrend,
    comparisonLabel,
    timeRange,

    // ── Revenue ──
    revenue, revenueTrend: hasTrend ? calculateTrend(revenue, prevRevenue) : null,
    profit, profitTrend: hasTrend ? calculateTrend(profit, prevProfit) : null,
    walletUsed, walletTrend: hasTrend ? calculateTrend(walletUsed, prevWalletUsed) : null,
    aov, aovTrend: hasTrend ? calculateTrend(aov, prevAov) : null,
    lostRevenue,
    discountRevenue,

    // ── Orders ──
    totalOrders: currentTotalOrders.length,
    successOrdersCount: successOrders.length,
    successTrend: hasTrend ? calculateTrend(successOrders.length, prevSuccessOrders.length) : null,
    orderHealth,

    // ── Customers ──
    newCustomers: newCustomersCount,
    customerTrend: hasTrend ? calculateTrend(newCustomersCount, prevNewCustomersCount) : null,
    firstTimeBuyers: firstTimeBuyersCount,
    returningCustomers: returningCount,
    returningCustomersTrend: hasTrend ? calculateTrend(returningCount, prevReturningCount) : null,
    activeBuyersCount,
    returningRate,

    // ── Conversion ──
    conversionRate,
    conversionTrend: hasTrend ? calculateTrend(conversionRate, prevConversionRate) : null,

    // ── Refunds / RTO ──
    totalRefundsProcessed,
    refundsTrend: hasTrend ? calculateTrend(totalRefundsProcessed, prevRefunds) : null,
    rtoRate,
    rtoCount: rtoOrders.length,

    // ── Cart Recovery ──
    cartRecovery: {
      abandonedCount: uniqueCartUsers.size,
      atRiskValue: abandonedVal,
      eligibleCount,
    },

    // ── Inventory ──
    lowStockVariants,
    lowStockCount: lowStockVariants.length,
    outOfStockCount: lowStockVariants.filter(v => v.stock === 0).length,

    // ── Charts ──
    categoryData: { labels: Object.keys(categoryStats), data: Object.values(categoryStats) },
    chartData: {
      labels: chartLabels,
      revenue: chartRevenue,
      prevRevenue: prevChartRevenue,
      volume: chartVolume,
    },

    // ── Products ──
    topProductsByVolume,
    topProductsByRevenue,

    // ── Geo ──
    geoDistribution,

    // ── Activity ──
    recentActivity,

    // ── Legacy ──
    abandonedVal,
    uniqueAbandonedCount: uniqueCartUsers.size,
    salesFunnel: { users: newCustomersCount + activeBuyersCount, carts: Array.isArray(allCarts) ? allCarts.length : 0, checkouts: rawCurrentOrders.length, paid: successOrders.length },
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// getAttentionCounts — lightweight parallel queries for the Attention section
// ─────────────────────────────────────────────────────────────────────────────
export const getAttentionCounts = async () => {
  const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const now = new Date();

  const [
    pendingOrdersRes,
    openTicketsRes,
    slaBreachRes,
    pendingRefundsRes,
    lowStockRes,
    expiringCouponsRes,
    rtoRes,
    returnRes,
  ] = await Promise.all([
    // 1. Pending orders (order placed but not confirmed/shipped)
    db.execute(sql`SELECT COUNT(*) as count FROM ${ordersTable} WHERE LOWER(status) = 'order placed'`),
    // 2. Open support tickets
    db.execute(sql`SELECT COUNT(*) as count FROM tickets WHERE status NOT IN ('resolved', 'closed', 'spam')`),
    // 3. SLA breached tickets
    db.execute(sql`SELECT COUNT(*) as count FROM tickets WHERE (is_first_response_breached = true OR is_resolution_breached = true) AND status NOT IN ('resolved', 'closed')`),
    // 4. Pending refunds (distinct orders needing attention)
    db.execute(sql`SELECT COUNT(DISTINCT order_id) as count FROM refunds WHERE refund_status IN ('pending', 'in_progress')`),
    // 5. Low stock variants
    db.execute(sql`SELECT COUNT(*) as count FROM product_variants WHERE stock < 10 AND is_archived = false AND is_active = true`),
    // 6. Coupons expiring within 7 days
    db.execute(sql`SELECT COUNT(*) as count FROM ${couponsTable} WHERE is_active = true AND valid_until IS NOT NULL AND valid_until >= ${now} AND valid_until <= ${sevenDaysFromNow}`),
    // 7. RTO orders (last 30 days)
    db.execute(sql`SELECT COUNT(*) as count FROM ${ordersTable} WHERE (LOWER(status) = 'rto' OR LOWER(status) = 'return to origin') AND created_at >= NOW() - INTERVAL '30 days'`),
    // 8. Active returns
    db.execute(sql`SELECT COUNT(*) as count FROM ${ordersTable} WHERE LOWER(status) LIKE '%return%' AND LOWER(status) NOT LIKE '%to origin%'`),
  ]);

  return {
    pendingOrders: parseInt(pendingOrdersRes.rows[0]?.count || 0),
    openTickets: parseInt(openTicketsRes.rows[0]?.count || 0),
    slaBreaches: parseInt(slaBreachRes.rows[0]?.count || 0),
    pendingRefunds: parseInt(pendingRefundsRes.rows[0]?.count || 0),
    lowStock: parseInt(lowStockRes.rows[0]?.count || 0),
    expiringCoupons: parseInt(expiringCouponsRes.rows[0]?.count || 0),
    rtoOrders: parseInt(rtoRes.rows[0]?.count || 0),
    activeReturns: parseInt(returnRes.rows[0]?.count || 0),
  };
};
