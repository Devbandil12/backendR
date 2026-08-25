import { db } from '../../db/client.js';
import { couponsTable } from '../../db/schema/index.js';
import { desc, and, eq, isNull, lte, or, gte } from 'drizzle-orm';

export const getLatestPublicPromos = async (now) => {
  return await db.select({ 
      id: couponsTable.id, 
      code: couponsTable.code, 
      description: couponsTable.description, 
      discountType: couponsTable.discountType, 
      discountValue: couponsTable.discountValue, 
      validFrom: couponsTable.validFrom 
    })
    .from(couponsTable)
    .where(and(
      eq(couponsTable.isAutomatic, false),
      or(isNull(couponsTable.validFrom), lte(couponsTable.validFrom, now)),
      or(isNull(couponsTable.validUntil), gte(couponsTable.validUntil, now))
    ))
    .orderBy(desc(couponsTable.validFrom), desc(couponsTable.id))
    .limit(2);
};
