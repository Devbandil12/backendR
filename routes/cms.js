import express from 'express';
import { db } from '../configs/index.js';
import { bannersTable, aboutUsTable } from '../configs/schema.js';
import { eq } from 'drizzle-orm';

// 1. Import Cache Helpers
import { cache, invalidateCache } from '../cacheMiddleware.js';

const router = express.Router();

// 2. DEFINE CACHE KEYS (This fixes your crash)
const BANNERS_CACHE_KEY = 'cms_banners_list';
const ABOUT_CACHE_KEY = 'cms_about_data';

// --- GET All Banners (Cached) ---
router.get('/banners', cache(BANNERS_CACHE_KEY), async (req, res) => {
  try {
    const banners = await db.select().from(bannersTable);
    res.json(banners);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch banners" });
  }
});

// --- POST (Create) a Banner ---
router.post('/banners', async (req, res) => {
  const { title, subtitle, imageUrl, link, buttonText, type, layout } = req.body;
  try {
    const [newBanner] = await db.insert(bannersTable).values({
      title, subtitle, imageUrl, link, buttonText,
      type: type || 'hero',
      layout: layout || 'split'
    }).returning();

    // Invalidate Cache so frontend gets new data
    await invalidateCache(BANNERS_CACHE_KEY);

    res.status(201).json(newBanner);
  } catch (error) {
    res.status(500).json({ error: "Failed to add banner" });
  }
});

// --- DELETE a Banner ---
router.delete('/banners/:id', async (req, res) => {
  try {
    await db.delete(bannersTable).where(eq(bannersTable.id, req.params.id));
    
    // Invalidate Cache
    await invalidateCache(BANNERS_CACHE_KEY);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete" });
  }
});

// --- TOGGLE Active Status ---
router.put('/banners/:id', async (req, res) => {
  try {
    const [updated] = await db.update(bannersTable)
      .set(req.body)
      .where(eq(bannersTable.id, req.params.id))
      .returning();

    // Invalidate Cache
    await invalidateCache(BANNERS_CACHE_KEY);

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: "Update failed" });
  }
});

// --- 🟢 GET About Us Data (Cached) ---
router.get('/about', cache(ABOUT_CACHE_KEY), async (req, res) => {
  try {
    const result = await db.select().from(aboutUsTable).limit(1);
    res.json(result.length > 0 ? result[0] : null);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch About Us" });
  }
});

// --- 🟢 POST/UPDATE About Us Data ---
router.post('/about', async (req, res) => {
  const data = req.body;
  try {
    const existing = await db.select().from(aboutUsTable).limit(1);
    
    if (existing.length === 0) {
      // Create
      const [newItem] = await db.insert(aboutUsTable).values(data).returning();
      
      // Invalidate Cache on Create
      await invalidateCache(ABOUT_CACHE_KEY);
      
      return res.status(201).json(newItem);
    } else {
      // Update
      const [updatedItem] = await db.update(aboutUsTable)
        .set(data)
        .where(eq(aboutUsTable.id, existing[0].id))
        .returning();
      
      // Invalidate Cache on Update
      await invalidateCache(ABOUT_CACHE_KEY);

      return res.json(updatedItem);
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to save About Us" });
  }
});

export default router;