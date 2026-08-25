import { db } from '../../db/client.js';
import { addToCartTable, ordersTable, orderItemsTable, productsTable, usersTable } from '../../db/schema/index.js';
import { eq, sql, desc, countDistinct } from 'drizzle-orm';

export const getFunnelStats = async () => {
    // 1. Total active users (who have accounts)
    const [{ totalUsers }] = await db.select({ totalUsers: countDistinct(usersTable.id) }).from(usersTable);
    
    // 2. Users who added to cart
    const [{ cartUsers }] = await db.select({ cartUsers: countDistinct(addToCartTable.userId) }).from(addToCartTable);
    
    // 3. Users who purchased
    const [{ purchasedUsers }] = await db.select({ purchasedUsers: countDistinct(ordersTable.userId) }).from(ordersTable);
    
    return [
        { stage: 'Registered Users', count: Number(totalUsers) },
        { stage: 'Added to Cart', count: Number(cartUsers) },
        { stage: 'Purchased', count: Number(purchasedUsers) }
    ];
};

export const getTopReturnedProducts = async () => {
    // Find products in orders that have refunds or status = 'returned' / 'cancelled'
    // We look at orderItems that belong to orders with refunds recorded or status 'cancelled'/'returned'
    const returnedItems = await db.select({
        productId: orderItemsTable.productId,
        productName: orderItemsTable.productName,
        img: orderItemsTable.img,
        returnCount: sql`COUNT(${orderItemsTable.id})`.mapWith(Number)
    })
    .from(orderItemsTable)
    .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
    .where(sql`${ordersTable.status} ILIKE '%cancel%' OR ${ordersTable.status} ILIKE '%return%' OR EXISTS (SELECT 1 FROM refunds r WHERE r.order_id = ${ordersTable.id} AND r.amount > 0)`)
    .groupBy(orderItemsTable.productId, orderItemsTable.productName, orderItemsTable.img)
    .orderBy(desc(sql`COUNT(${orderItemsTable.id})`))
    .limit(5);

    return returnedItems;
};
