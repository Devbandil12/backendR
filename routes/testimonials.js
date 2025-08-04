import express from 'express';
import { db } from '../configs/index.js';
import { testimonials } from '../schema.js';
import { desc } from 'drizzle-orm';

const router = express.Router();

// GET testimonials
router.get('/', async (req, res) => {
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

    res.status(201).json({ success: true });
  } catch (err) {
    console.error("POST /testimonials error:", err);
    res.status(500).json({ error: 'Failed to add testimonial' });
  }
});

export default router;
