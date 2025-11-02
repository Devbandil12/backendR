// file routes/testimonials.js

import express from 'express';
import { db } from '../configs/index.js';
import { testimonials } from '../configs/schema.js';
import { desc } from 'drizzle-orm';
// 🟢 Import new cache helpers
import { cache } from "../cacheMiddleware.js";
import { invalidateMultiple } from "../invalidateHelpers.js";
import { makeAllTestimonialsKey } from "../cacheKeys.js";

const router = express.Router();

// ========================
// GET testimonials
// ========================
// 🟢 Use new cache key builder
router.get('/', cache(makeAllTestimonialsKey(), 3600), async (req, res) => {
  try {
    const result = await db
      .select()
      .from(testimonials)
      .orderBy(desc(testimonials.createdAt));

    // Avatar is already a Cloudinary URL
    const testimonialsWithAvatars = result.map(t => ({
      ...t,
      avatar: t.avatar || null,
    }));

    res.json(testimonialsWithAvatars);
  } catch (err) {
    console.error("GET /testimonials error:", err);
    res.status(500).json({ error: 'Failed to load testimonials' });
  }
});

// ========================
// POST new testimonial
// ========================
router.post('/', async (req, res) => {
  try {
    const { name, title, text, rating, avatar } = req.body;

    await db.insert(testimonials).values({
      name,
      title,
      text,
      rating,
      avatar, // store Cloudinary URL directly
    });

    // 🟢 Use new invalidation helper
    await invalidateMultiple([{ key: makeAllTestimonialsKey() }]);

    res.status(201).json({ success: true });
  } catch (err) {
    console.error("POST /testimonials error:", err);
    res.status(500).json({ error: 'Failed to add testimonial' });
  }
});

export default router;