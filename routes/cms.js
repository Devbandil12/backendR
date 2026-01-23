// ✅ file: routes/cms.js
import express from 'express';
import { db } from '../configs/index.js';
import { bannersTable, aboutUsTable } from '../configs/schema.js';
import { eq } from 'drizzle-orm';

// 1. Import Cache Helpers
import { cache } from '../cacheMiddleware.js';
import { invalidateMultiple } from '../invalidateHelpers.js';

// 🔒 SECURITY: Import Middleware
import { requireAuth, verifyAdmin } from "../middleware/authMiddleware.js";

const router = express.Router();

// 2. DEFINE CACHE KEYS
const BANNERS_CACHE_KEY = 'cms_banners_list';
const ABOUT_CACHE_KEY = 'cms_about_data';

/* ======================================================
   🟢 GET ALL BANNERS (Public)
====================================================== */
router.get('/banners', cache(() => BANNERS_CACHE_KEY, 3600), async (req, res) => {
  try {
    const banners = await db.select().from(bannersTable);
    res.json(banners);
  } catch (error) {
    console.error("GET banners error:", error);
    res.status(500).json({ error: "Failed to fetch banners" });
  }
});

/* ======================================================
   🔒 CREATE BANNER (Admin Only)
====================================================== */
router.post('/banners', requireAuth, verifyAdmin, async (req, res) => {
  const { title, subtitle, imageUrl, link, buttonText, type, layout } = req.body;
  try {
    const [newBanner] = await db.insert(bannersTable).values({
      title, subtitle, imageUrl, link, buttonText,
      type: type || 'hero',
      layout: layout || 'split'
    }).returning();

    // Invalidate Cache
    await invalidateMultiple([{ key: BANNERS_CACHE_KEY }]);

    res.status(201).json(newBanner);
  } catch (error) {
    console.error("POST banners error:", error);
    res.status(500).json({ error: "Failed to add banner" });
  }
});

/* ======================================================
   🔒 DELETE BANNER (Admin Only)
====================================================== */
router.delete('/banners/:id', requireAuth, verifyAdmin, async (req, res) => {
  try {
    await db.delete(bannersTable).where(eq(bannersTable.id, req.params.id));
    
    // Invalidate Cache
    await invalidateMultiple([{ key: BANNERS_CACHE_KEY }]);

    res.json({ success: true });
  } catch (error) {
    console.error("DELETE banners error:", error);
    res.status(500).json({ error: "Failed to delete" });
  }
});

/* ======================================================
   🔒 UPDATE BANNER (Admin Only)
====================================================== */
router.put('/banners/:id', requireAuth, verifyAdmin, async (req, res) => {
  try {
    const [updated] = await db.update(bannersTable)
      .set(req.body)
      .where(eq(bannersTable.id, req.params.id))
      .returning();

    // Invalidate Cache
    await invalidateMultiple([{ key: BANNERS_CACHE_KEY }]);

    res.json(updated);
  } catch (error) {
    console.error("PUT banners error:", error);
    res.status(500).json({ error: "Update failed" });
  }
});

/* ======================================================
   🟢 GET ABOUT US (Public)
====================================================== */
router.get('/about', cache(() => ABOUT_CACHE_KEY, 3600), async (req, res) => {
  try {
    const result = await db.select().from(aboutUsTable).limit(1);
    res.json(result.length > 0 ? result[0] : null);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch About Us" });
  }
});

/* ======================================================
   🔒 UPSERT ABOUT US (Admin Only)
====================================================== */
router.post('/about', requireAuth, verifyAdmin, async (req, res) => {
  const data = req.body;
  try {
    const existing = await db.select().from(aboutUsTable).limit(1);
    
    let result;
    if (existing.length === 0) {
      // Create
      const [newItem] = await db.insert(aboutUsTable).values(data).returning();
      result = newItem;
    } else {
      // Update
      const [updatedItem] = await db.update(aboutUsTable)
        .set(data)
        .where(eq(aboutUsTable.id, existing[0].id))
        .returning();
      result = updatedItem;
    }

    // Invalidate Cache
    await invalidateMultiple([{ key: ABOUT_CACHE_KEY }]);

    res.status(existing.length === 0 ? 201 : 200).json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to save About Us" });
  }
});

export default router;