import express from 'express';
import { db } from '../configs/index.js';
import { bannersTable, aboutUsTable } from '../configs/schema.js';
import { eq } from 'drizzle-orm';

const router = express.Router();

// GET all banners
router.get('/banners', async (req, res) => {
  try {
    const banners = await db.select().from(bannersTable);
    res.json(banners);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch banners" });
  }
});

// POST (Create) a banner
router.post('/banners', async (req, res) => {
  const { title, subtitle, imageUrl, link, buttonText, type, layout } = req.body;
  try {
    const [newBanner] = await db.insert(bannersTable).values({
      title, subtitle, imageUrl, link, buttonText,
      type: type || 'hero',
      layout: layout || 'split'
    }).returning();
    res.status(201).json(newBanner);
  } catch (error) {
    res.status(500).json({ error: "Failed to add banner" });
  }
});

// DELETE a banner
router.delete('/banners/:id', async (req, res) => {
  try {
    await db.delete(bannersTable).where(eq(bannersTable.id, req.params.id));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete" });
  }
});

// TOGGLE Active Status
router.put('/banners/:id', async (req, res) => {
  try {
    const [updated] = await db.update(bannersTable)
      .set(req.body)
      .where(eq(bannersTable.id, req.params.id))
      .returning();
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: "Update failed" });
  }
});

// 🟢 NEW: GET About Us Data
router.get('/about', async (req, res) => {
  try {
    const result = await db.select().from(aboutUsTable).limit(1);
    res.json(result.length > 0 ? result[0] : null);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch About Us" });
  }
});

// 🟢 NEW: POST/UPDATE About Us Data
router.post('/about', async (req, res) => {
  const data = req.body;
  try {
    const existing = await db.select().from(aboutUsTable).limit(1);
    
    if (existing.length === 0) {
      // Create
      const [newItem] = await db.insert(aboutUsTable).values(data).returning();
      return res.status(201).json(newItem);
    } else {
      // Update
      const [updatedItem] = await db.update(aboutUsTable)
        .set(data)
        .where(eq(aboutUsTable.id, existing[0].id))
        .returning();
      return res.json(updatedItem);
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to save About Us" });
  }
});

export default router;