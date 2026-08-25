import { db } from '../../db/client.js';
import { ordersTable, orderTimeline, orderItemsTable, productVariantsTable, productBundlesTable } from '../../db/schema/index.js';
import { eq, or, sql } from 'drizzle-orm';

export const getOrderForWebhook = async (shiprocketAwb, shiprocketOrderId, shiprocketShipmentId) => {
  const searchConditions = [];
  if (shiprocketAwb) searchConditions.push(eq(ordersTable.shiprocketAwb, String(shiprocketAwb)));
  if (shiprocketOrderId) searchConditions.push(eq(ordersTable.shiprocketOrderId, String(shiprocketOrderId)));
  if (shiprocketShipmentId) searchConditions.push(eq(ordersTable.shiprocketShipmentId, String(shiprocketShipmentId)));

  if (searchConditions.length === 0) return null;

  const [order] = await db
    .select()
    .from(ordersTable)
    .where(or(...searchConditions));

  return order;
};

export const updateOrderAndStockInTransaction = async (order, mappedStatus, shiprocketAwb, courierName, shiprocketOrderId, shiprocketShipmentId, expectedDelivery, rawStatus, activityDescription, payloadScansLocation) => {
  let cacheKeysToInvalidate = [];

  await db.transaction(async (tx) => {
    await tx.update(ordersTable)
      .set({
        shiprocketAwb: shiprocketAwb || order.shiprocketAwb,
        ...(mappedStatus ? { status: mappedStatus } : {}),
        courierName: courierName || order.courierName,
        shiprocketOrderId: shiprocketOrderId ? String(shiprocketOrderId) : order.shiprocketOrderId,
        shiprocketShipmentId: shiprocketShipmentId ? String(shiprocketShipmentId) : order.shiprocketShipmentId,
        expectedDeliveryDate: expectedDelivery ? new Date(expectedDelivery) : order.expectedDeliveryDate,
        updatedAt: new Date(),
        progressStep: 
          mappedStatus === 'Processing' ? 2 :
          mappedStatus === 'Packed' ? 2 :
          mappedStatus === 'Shipped' ? 3 :
          mappedStatus === 'Delivered' ? 4 :
          mappedStatus === 'Order Cancelled' ? 0 : 
          order.progressStep
      })
      .where(eq(ordersTable.id, order.id));
    
    await tx.insert(orderTimeline).values({
      orderId: order.id,
      status: mappedStatus || order.status,
      title: mappedStatus || rawStatus,
      description: `${activityDescription} (Location: ${payloadScansLocation || 'N/A'})`,
      timestamp: new Date(),
    });

    if (mappedStatus === 'Returned') {
      console.log(`📦 Restoring stock for returned order ${order.id}...`);
      
      const orderItems = await tx.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, order.id));
      
      for (const item of orderItems) {
        await tx.update(productVariantsTable).set({
          stock: sql`${productVariantsTable.stock} + ${item.quantity}`,
          sold: sql`${productVariantsTable.sold} - ${item.quantity}`
        }).where(eq(productVariantsTable.id, item.variantId));

        const bundleContents = await tx.select().from(productBundlesTable)
          .where(eq(productBundlesTable.bundleVariantId, item.variantId));

        for (const content of bundleContents) {
          const qtyToRestore = item.quantity * content.quantity;
          await tx.update(productVariantsTable).set({
            stock: sql`${productVariantsTable.stock} + ${qtyToRestore}`,
            sold: sql`${productVariantsTable.sold} - ${qtyToRestore}`
          }).where(eq(productVariantsTable.id, content.contentVariantId));
        }
        cacheKeysToInvalidate.push(item.productId);
      }
    }
  });

  return cacheKeysToInvalidate;
};

export const updateOrderRefundStatus = async (orderId, refundId, refundAmount, refundStatus) => {
  const { recordRefund } = await import('../orders/refunds.compatibility.js');
  await recordRefund({
    orderId,
    amount: refundAmount, // in paise
    refundStatus: refundStatus, // lowercase legacy
    gatewayRefundId: refundId,
    reason: 'Automated RTO / delivery issue refund',
  });
};

export const insertTimelineEvent = async (orderId, status, title, description) => {
  await db.insert(orderTimeline).values({
    orderId,
    status,
    title,
    description,
    timestamp: new Date()
  });
};
