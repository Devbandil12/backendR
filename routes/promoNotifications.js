// routes/promoNotifications.js
import express from 'express';
import { db } from '../configs/index.js';
import { couponsTable } from '../configs/schema.js';
import { eq, desc, and, isNull, lte, or, gte } from 'drizzle-orm';
import { cache } from '../cacheMiddleware.js';

const router = express.Router();

// GET /api/promos/latest-public
// Fetches the top 2-3 newest, active, *manual* coupons for display
router.get('/latest-public', cache(() => 'promos:latest-public', 3600), async (req, res) => {
    try {
        const now = new Date();
        const promos = await db.select({
            id: couponsTable.id,
            code: couponsTable.code,
            description: couponsTable.description,
            discountType: couponsTable.discountType,
            discountValue: couponsTable.discountValue,
        })
        .from(couponsTable)
        .where(and(
            eq(couponsTable.isAutomatic, false), // Only show manual coupons
            or(isNull(couponsTable.validFrom), lte(couponsTable.validFrom, now)),
            or(isNull(couponsTable.validUntil), gte(couponsTable.validUntil, now))
        ))
        .orderBy(desc(couponsTable.validFrom), desc(couponsTable.id)) // Show newest first
        .limit(2); // Only show the top 2

        res.json(promos);
    } catch (err) {
        console.error("Error fetching latest promos:", err);
        res.status(500).json({ error: "Server error" });
    }
});

export default router;