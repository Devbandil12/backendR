// ✅ file: routes/testimonials.js

import express from 'express';
import { db } from '../configs/index.js';
import { testimonials, usersTable } from '../configs/schema.js';
import { desc, eq } from 'drizzle-orm';
import { cache } from "../cacheMiddleware.js";
import { invalidateMultiple } from "../invalidateHelpers.js";
import { makeAllTestimonialsKey } from "../cacheKeys.js";

// 🔒 SECURITY: Import Middleware
import { requireAuth } from "../middleware/authMiddleware.js";

const router = express.Router();

/* ======================================================
   🟢 GET TESTIMONIALS (Public)
====================================================== */
router.get('/', cache(() => makeAllTestimonialsKey(), 3600), async (req, res) => {
  try {
    const result = await db
      .select()
      .from(testimonials)
      .orderBy(desc(testimonials.createdAt));

    res.json(result);
  } catch (err) {
    console.error("GET /testimonials error:", err);
    res.status(500).json({ error: 'Failed to load testimonials' });
  }
});

/* ======================================================
   🔒 POST TESTIMONIAL (Authenticated Users)
   - Changed from verifyAdmin to requireAuth so users can post
====================================================== */
router.post('/', requireAuth, async (req, res) => {
  try {
    const { name, title, text, rating, avatar } = req.body;
    const requesterClerkId = req.auth.userId;

    // Optional: Fetch user details from DB to ensure valid user
    const user = await db.query.usersTable.findFirst({
        where: eq(usersTable.clerkId, requesterClerkId)
    });

    if (!user) return res.status(401).json({ error: "User not found" });

    await db.insert(testimonials).values({
      name: name || user.name, // Use provided name or DB name
      title: title || "Verified Customer",
      text,
      rating: rating || 5,
      avatar: avatar || null, 
    });

    // Invalidate Cache
    await invalidateMultiple([{ key: makeAllTestimonialsKey() }]);

    res.status(201).json({ success: true });
  } catch (err) {
    console.error("POST /testimonials error:", err);
    res.status(500).json({ error: 'Failed to add testimonial' });
  }
});

export default router;