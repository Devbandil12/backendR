import { db } from "../../db/client.js";
import {
  orderItemsTable,
  ordersTable,
  productsTable,
  productVariantsTable,
  usersTable,
  productBundlesTable,
  orderTimeline,
  couponRedemptionsTable,
  orderNotesTable,
  returnsTable,
  returnItemsTable,
  refundsTable
} from "../../db/schema/index.js";
import { eq, asc, desc, sql, inArray, and, gte, lte, ilike, or, notIlike, lt, gt } from "drizzle-orm"; 

export const getOrdersByDateRange = async (startDate, endDate) => {
  return await db
    .select({
      id: ordersTable.id,
      userId: ordersTable.userId,
      status: ordersTable.status,
      totalAmount: ordersTable.totalAmount,
      createdAt: ordersTable.createdAt,
      paymentMode: ordersTable.paymentMode,
      paymentStatus: ordersTable.paymentStatus,
      walletAmountUsed: ordersTable.walletAmountUsed,
    })
    .from(ordersTable)
    .where(and(gte(ordersTable.createdAt, startDate), lte(ordersTable.createdAt, endDate)));
};

export const getAllOrders = async (params = {}) => {
  const page = Number(params.page) || 1;
  const limit = Number(params.limit) || 20;
  const {
    search = '',
    status = '',
    paymentStatus = '',
    fulfillmentStatus = '',
    returnStatus = '',
    refundStatus = '',
    startDate,
    endDate,
    sortBy = 'createdAt',
    sortOrder = 'desc',
    cursor,
    requiresAttention
  } = params;

  let conditions = [];

  if (search) {
    const searchPattern = `%${search}%`;
    conditions.push(
      or(
        ilike(ordersTable.id, searchPattern),
        ilike(ordersTable.invoiceNumber, searchPattern),
        ilike(ordersTable.shiprocketAwb, searchPattern),
        ilike(ordersTable.trackingId, searchPattern),
        ilike(usersTable.name, searchPattern),
        ilike(usersTable.email, searchPattern),
        ilike(usersTable.phone, searchPattern),
        inArray(ordersTable.id, db.select({ orderId: orderItemsTable.orderId }).from(orderItemsTable).where(ilike(orderItemsTable.productName, searchPattern)))
      )
    );
  }

  if (paymentStatus) conditions.push(sql`LOWER(${ordersTable.paymentStatus}) = LOWER(${paymentStatus})`);
  if (fulfillmentStatus) conditions.push(sql`LOWER(${ordersTable.fulfillmentStatus}) = LOWER(${fulfillmentStatus})`);
  if (returnStatus) conditions.push(sql`LOWER(${ordersTable.returnStatus}) = LOWER(${returnStatus})`);
  if (refundStatus) {
    conditions.push(sql`EXISTS (
      SELECT 1 FROM refunds r WHERE r.order_id = ${ordersTable.id} AND LOWER(r.refund_status) = LOWER(${refundStatus})
    )`);
  }
  
  if (startDate && endDate) {
    conditions.push(and(gte(ordersTable.createdAt, new Date(startDate)), lte(ordersTable.createdAt, new Date(endDate))));
  }

  if (status && status !== 'All') {
    if (status === 'Cancelled') {
      conditions.push(eq(ordersTable.status, 'Order Cancelled'));
    } else if (status === 'Payment Pending') {
      conditions.push(
        and(
          eq(ordersTable.status, 'Order Placed'),
          eq(ordersTable.paymentStatus, 'pending'),
          eq(ordersTable.paymentMode, 'online')
        )
      );
    } else if (status === 'Returns') {
      conditions.push(
        or(
          ilike(ordersTable.status, '%return%'),
          ilike(ordersTable.status, '%rto%')
        )
      );
    } else {
      conditions.push(ilike(ordersTable.status, status));
    }
  }

  if (requiresAttention === 'true') {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    conditions.push(
      or(
         eq(ordersTable.returnStatus, 'REQUESTED'),
         sql`EXISTS (SELECT 1 FROM refunds r WHERE r.order_id = ${ordersTable.id} AND r.refund_status IN ('pending', 'in_progress'))`,
         eq(ordersTable.status, 'RTO Initiated'),
         and(eq(ordersTable.status, 'Order Placed'), lte(ordersTable.createdAt, twoDaysAgo)),
         and(eq(ordersTable.fulfillmentStatus, 'PROCESSING'), lte(ordersTable.updatedAt, twoDaysAgo))
      )
    );
  }

  if (cursor) {
    if (sortOrder === 'desc') {
      conditions.push(lt(ordersTable[sortBy], new Date(cursor))); 
    } else {
      conditions.push(gt(ordersTable[sortBy], new Date(cursor)));
    }
  }

  let whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  
  const sortCol = ordersTable[sortBy] || ordersTable.createdAt;
  const orderByClause = sortOrder === 'asc' ? asc(sortCol) : desc(sortCol);

  const data = await db
    .select({
      id: ordersTable.id,
      userId: ordersTable.userId,
      status: ordersTable.status,
      totalAmount: ordersTable.totalAmount,
      createdAt: ordersTable.createdAt,
      userEmail: usersTable.email,
      userName: usersTable.name,
      paymentMode: ordersTable.paymentMode,
      paymentStatus: ordersTable.paymentStatus,
      fulfillmentStatus: ordersTable.fulfillmentStatus,
      returnStatus: ordersTable.returnStatus,
      walletAmountUsed: ordersTable.walletAmountUsed,
      shiprocketOrderId: ordersTable.shiprocketOrderId,
      shiprocketAwb: ordersTable.shiprocketAwb,
      invoiceNumber: ordersTable.invoiceNumber,
      trackingId: ordersTable.trackingId,
    })
    .from(ordersTable)
    .leftJoin(usersTable, eq(ordersTable.userId, usersTable.id))
    .where(whereClause)
    .orderBy(orderByClause)
    .limit(limit)
    .offset(cursor ? 0 : (page - 1) * limit);

  if (data.length > 0) {
    const orderIds = data.map(o => o.id);
    const items = await db
      .select({
        id: orderItemsTable.id,
        orderId: orderItemsTable.orderId,
        productName: orderItemsTable.productName,
        img: orderItemsTable.img,
        quantity: orderItemsTable.quantity,
        price: orderItemsTable.price,
        totalPrice: orderItemsTable.totalPrice,
        size: orderItemsTable.size,
        productId: orderItemsTable.productId,
        variantId: orderItemsTable.variantId,
      })
      .from(orderItemsTable)
      .where(inArray(orderItemsTable.orderId, orderIds));

    const itemsMap = {};
    for (const item of items) {
      if (!itemsMap[item.orderId]) itemsMap[item.orderId] = [];
      itemsMap[item.orderId].push(item);
    }

    for (const order of data) {
      order.orderItems = itemsMap[order.id] || [];
      order.items = order.orderItems;
      order.itemCount = order.orderItems.reduce((sum, it) => sum + (it.quantity || 1), 0);
    }
  }

  const [{ count }] = await db
    .select({ count: sql`count(*)` })
    .from(ordersTable)
    .leftJoin(usersTable, eq(ordersTable.userId, usersTable.id))
    .where(whereClause);

  return {
    data,
    meta: {
      totalCount: Number(count),
      totalPages: Math.ceil(Number(count) / limit),
      currentPage: Number(page)
    }
  };
};

export const getOrderByIdWithDetails = async (orderId) => {
  return await db.query.ordersTable.findFirst({
    where: eq(ordersTable.id, orderId),
    with: {
      user: { columns: { name: true, phone: true, email: true } },
      address: {
        columns: {
          address: true,
          landmark: true,
          city: true,
          state: true,
          postalCode: true,
          country: true,
          phone: true,
        },
      },
      orderItems: {
        with: {
          product: true,
          variant: true,
        },
      },
      timeline: {
        orderBy: (timeline, { desc }) => [desc(timeline.timestamp)],
      },
      refunds: true,
      returns: {
        with: { returnItems: true }
      },
      notes: {
        with: { admin: { columns: { name: true, email: true } } }
      }
    },
  });
};

export const getUserOrders = async (userId) => {
  return await db.query.ordersTable.findMany({
    where: eq(ordersTable.userId, userId),
    with: {
      orderItems: { with: { product: true, variant: true } },
      timeline: { orderBy: (timeline, { desc }) => [desc(timeline.timestamp)] }
    },
    orderBy: [asc(ordersTable.createdAt)],
  });
};

export const updateOrder = async (id, updateData, expectedVersion = null, tx = null) => {
  let condition = eq(ordersTable.id, id);
  if (expectedVersion !== null) {
    condition = and(condition, eq(ordersTable.version, expectedVersion));
  }
  
  const client = tx || db;

  const [updatedOrder] = await client
    .update(ordersTable)
    .set({ 
      ...updateData, 
      version: expectedVersion !== null ? expectedVersion + 1 : sql`${ordersTable.version} + 1`,
      updatedAt: new Date() 
    })
    .where(condition)
    .returning();
    
  if (!updatedOrder && expectedVersion !== null) {
    throw new Error("ConcurrencyConflict: Order has been modified by another process. Please refresh and try again.");
  }
  
  return updatedOrder;
};

export const getOrderById = async (id, tx = null) => {
  const client = tx || db;
  const [order] = await client.select().from(ordersTable).where(eq(ordersTable.id, id));
  return order;
};

export const insertTimelineEvent = async (eventData, tx = null) => {
  const client = tx || db;
  await client.insert(orderTimeline).values(eventData);
};

// logActivity removed. Use new audit service.

export const cancelCouponRedemptions = async (orderId) => {
  await db.update(couponRedemptionsTable)
    .set({ status: 'cancelled' })
    .where(eq(couponRedemptionsTable.orderId, orderId));
};

export const getOrderItems = async (orderId) => {
  return await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, orderId));
};

export const restoreStock = async (variantId, quantity) => {
  await db.update(productVariantsTable).set({
    stock: sql`${productVariantsTable.stock} + ${quantity}`,
    sold: sql`${productVariantsTable.sold} - ${quantity}`
  }).where(eq(productVariantsTable.id, variantId));
};

export const getBundleContents = async (variantId) => {
  return await db.select().from(productBundlesTable)
    .where(eq(productBundlesTable.bundleVariantId, variantId));
};

export const getOrdersForReports = async () => {
  return await db.query.ordersTable.findMany({
    with: {
      orderItems: {
        with: {
          product: true,
          variant: true,
        },
      },
    },
  });
};

export const bulkUpdateOrdersStatus = async (orderIds, status, newProgressStep, newFulfillmentStatus = null) => {
  const updateData = {
    status: status,
    progressStep: newProgressStep,
    updatedAt: new Date()
  };
  
  if (newFulfillmentStatus) {
    updateData.fulfillmentStatus = newFulfillmentStatus;
  }

  return await db
    .update(ordersTable)
    .set(updateData)
    .where(inArray(ordersTable.id, orderIds))
    .returning();
};

export const bulkInsertTimelineEvents = async (events) => {
  await db.insert(orderTimeline).values(events);
};

export const insertOrderNote = async (noteData) => {
  const [note] = await db.insert(orderNotesTable).values(noteData).returning();
  return note;
};

export const getCustomerStats = async (userId) => {
  const orders = await db.query.ordersTable.findMany({
    where: eq(ordersTable.userId, userId),
    columns: {
      status: true,
      totalAmount: true,
      returnStatus: true,
    }
  });

  let totalOrders = 0;
  let ltv = 0;
  let cancellations = 0;
  let returns = 0;

  for (const o of orders) {
    totalOrders++;
    if (o.status === 'Cancelled' || o.status === 'CANCELLED') cancellations++;
    if (o.returnStatus !== 'NONE') returns++;
    if (o.status === 'Delivered' || o.status === 'COMPLETED') ltv += Number(o.totalAmount || 0);
  }

  const codRisk = cancellations > 0 ? (cancellations / totalOrders > 0.3 ? 'HIGH' : 'MEDIUM') : 'LOW';

  return { totalOrders, ltv, cancellations, returns, codRisk };
};

export const getOrdersByIds = async (orderIds) => {
  return await db.query.ordersTable.findMany({
    where: inArray(ordersTable.id, orderIds),
    with: { address: true, orderItems: { with: { variant: true } } },
  });
};

export const lockOrderForReturn = async (id) => {
  const [lockedOrder] = await db.update(ordersTable)
    .set({ status: 'Processing Return', updatedAt: new Date() })
    .where(and(
      eq(ordersTable.id, id),
      eq(ordersTable.status, 'Delivered')
    ))
    .returning();
  return lockedOrder;
};

export const executeTransaction = async (callback) => {
  return await db.transaction(callback);
};

export const getOrderSummary = async () => {
  const query = sql`
    SELECT
      COUNT(*)::int as "totalOrders",
      COALESCE(SUM(CASE WHEN DATE(created_at) = CURRENT_DATE THEN 1 ELSE 0 END), 0)::int as "todayOrders",
      COALESCE(SUM(CASE WHEN DATE(created_at) = CURRENT_DATE THEN total_amount ELSE 0 END), 0)::int as "todayRevenue",
      COALESCE(SUM(CASE WHEN payment_status = 'PENDING' THEN 1 ELSE 0 END), 0)::int as "pendingPayment",
      COALESCE(SUM(CASE WHEN fulfillment_status = 'PROCESSING' THEN 1 ELSE 0 END), 0)::int as "processing",
      COALESCE(SUM(CASE WHEN fulfillment_status = 'READY_TO_SHIP' THEN 1 ELSE 0 END), 0)::int as "readyToShip",
      COALESCE(SUM(CASE WHEN status = 'RTO' THEN 1 ELSE 0 END), 0)::int as "rto",
      COALESCE(SUM(CASE WHEN return_status = 'REQUESTED' THEN 1 ELSE 0 END), 0)::int as "returnsPending",
      COALESCE((SELECT COUNT(DISTINCT order_id)::int FROM refunds WHERE refund_status IN ('pending', 'in_progress')), 0) as "refundsPending"
    FROM orders
  `;
  const { rows } = await db.execute(query);
  return rows[0];
};

export const insertAdminReturn = async (orderId, userId, reason, adminNotes, items, expectedVersion = null) => {
  return await db.transaction(async (tx) => {
    // 1. Create return record
    const [newReturn] = await tx.insert(returnsTable).values({
      orderId,
      userId,
      reason,
      adminNotes,
      returnStatus: 'APPROVED' // Admin initiated is approved
    }).returning();

    // 2. Create return items
    if (items && items.length > 0) {
      const returnItemsData = items.map(item => ({
        returnId: newReturn.id,
        orderItemId: item.orderItemId,
        quantity: item.quantity,
        condition: item.condition
      }));
      await tx.insert(returnItemsTable).values(returnItemsData);
    }

    // 3. Update main order status with optimistic concurrency check
    let condition = eq(ordersTable.id, orderId);
    if (expectedVersion !== null) {
      condition = and(condition, eq(ordersTable.version, expectedVersion));
    }

    const [updatedOrder] = await tx.update(ordersTable)
      .set({
        returnStatus: 'APPROVED',
        version: expectedVersion !== null ? expectedVersion + 1 : sql`${ordersTable.version} + 1`,
        updatedAt: new Date()
      })
      .where(condition)
      .returning();

    if (!updatedOrder && expectedVersion !== null) {
      throw new Error("ConcurrencyConflict: Order has been modified by another process. Please refresh and try again.");
    }

    return newReturn;
  });
};

export const insertAdminRefund = async (orderId, amount, reason, gatewayRefundId = null, returnId = null, expectedVersion = null) => {
  return await db.transaction(async (tx) => {
    const { recordRefund } = await import('./refunds.compatibility.js');
    
    const parsedAmount = Number(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      throw new Error("RefundAmountInvalid: Refund amount must be greater than zero.");
    }

    // Convert rupees to paise (e.g. 500 -> 50000 paise)
    const amountInPaise = Math.round(parsedAmount * 100);
    if (amountInPaise <= 0) {
      throw new Error("RefundAmountInvalid: Refund amount must be greater than zero.");
    }

    // Financial Over-Refund Check
    const existingRefunds = await tx.select().from(refundsTable).where(eq(refundsTable.orderId, orderId));
    const alreadyRefundedPaise = existingRefunds
      .filter(r => r.refundStatus === 'processed' || r.refundStatus === 'in_progress')
      .reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

    const [targetOrder] = await tx.select({
      totalAmount: ordersTable.totalAmount,
      walletAmountUsed: ordersTable.walletAmountUsed,
      version: ordersTable.version
    }).from(ordersTable).where(eq(ordersTable.id, orderId));

    if (!targetOrder) {
      throw new Error("OrderNotFound: Order does not exist.");
    }

    const orderTotalPaise = Math.round(((Number(targetOrder?.totalAmount) || 0) + (Number(targetOrder?.walletAmountUsed) || 0)) * 100);
    const remainingRefundablePaise = Math.max(0, orderTotalPaise - alreadyRefundedPaise);

    if (remainingRefundablePaise <= 0) {
      throw new Error("RefundExceedsOrderTotal: Order is already fully refunded. Remaining refundable balance is ₹0.00.");
    }

    if (amountInPaise > remainingRefundablePaise) {
      throw new Error(`RefundExceedsOrderTotal: Requested refund of ₹${(amountInPaise / 100).toFixed(2)} exceeds maximum refundable amount of ₹${(remainingRefundablePaise / 100).toFixed(2)}.`);
    }

    const { refund } = await recordRefund({
      orderId,
      amount: amountInPaise,
      refundStatus: 'processed', // lowercase standard
      gatewayRefundId,
      reason,
      returnId,
      expectedVersion,
      tx
    });

    // Record timeline entry
    await tx.insert(orderTimeline).values({
      orderId,
      status: 'REFUND_PROCESSED',
      title: `Refund of ₹${(amountInPaise / 100).toFixed(2)} Processed`,
      description: reason ? `Reason: ${reason}` : 'Admin initiated refund',
    });

    return refund;
  });
};
