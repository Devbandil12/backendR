import express from 'express';
import { db } from '../configs/index.js';
import { testimonials } from '../configs/schema.js';
import { eq, desc } from 'drizzle-orm';
// 🟢 Import your cache middleware
import { cache, invalidateCache } from "../cacheMiddleware.js";

const router = express.Router();

// GET testimonials
// 🟢 Apply the cache middleware to the GET route
router.get('/', cache("all-testimonials", 3600), async (req, res) => {
  try {
    const result = await db.select().from(testimonials).orderBy(desc(testimonials.createdAt));
    const testimonialsWithAvatars = result.map(t => ({
      ...t,
      avatar: t.avatar
        ? `data:image/jpeg;base64,${Buffer.from(t.avatar).toString('base64')}`
        : null,
    }));
    res.json(testimonialsWithAvatars);
  } catch (err) {
    console.error("GET /testimonials error:", err);
    res.status(500).json({ error: 'Failed to load testimonials' });
  }
});

// POST new testimonial
// 🟢 Add a middleware function to invalidate the cache after a new testimonial is created
router.post('/', async (req, res) => {
  try {
    const { name, title, text, rating, avatar } = req.body;
    const avatarBuffer = avatar ? Buffer.from(avatar.split(',')[1], 'base64') : null;

    await db.insert(testimonials).values({
      name,
      title,
      text,
      rating,
      avatar: avatarBuffer,
    });
    
    // 🟢 Invalidate the cache for all testimonials
    await invalidateCache("all-testimonials");

    res.status(201).json({ success: true });
  } catch (err) {
    console.error("POST /testimonials error:", err);
    res.status(500).json({ error: 'Failed to add testimonial' });
  }
});

export default router;