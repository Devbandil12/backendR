import express from 'express';
import { db } from '../configs/index.js';
import { testimonials } from '../configs/schema.js';
import { desc } from 'drizzle-orm';
import { cache, invalidateCache } from "../cacheMiddleware.js";

const router = express.Router();

// ========================
// GET testimonials
// ========================
router.get('/', cache("all-testimonials", 3600), async (req, res) => {
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

    // Invalidate cache after adding new testimonial
    await invalidateCache("all-testimonials");

    res.status(201).json({ success: true });
  } catch (err) {
    console.error("POST /testimonials error:", err);
    res.status(500).json({ error: 'Failed to add testimonial' });
  }
});

export default router;
