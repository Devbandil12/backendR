import express from 'express';
import * as ctrl from './site.controller.js';
import { requireAuth, verifyAdmin, requirePermission } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rate-limit.js';

const router = express.Router();

const waitlistRateLimiter = rateLimit({
  windowSeconds: 60,
  max: 10,
  keyPrefix: 'rl:waitlist-sub',
  message: 'Too many requests. Please wait a few moments before trying again.',
});

// ── Public Routes ─────────────────────────────────────────────────────────────
// Highly optimized, cached, unauthenticated endpoint for the frontend
router.get('/status', ctrl.getSiteStatus);
router.get('/announcements', ctrl.getAnnouncements);
router.post('/waitlist/subscribe', waitlistRateLimiter, ctrl.subscribeWaitlist);

// ── Admin Routes ──────────────────────────────────────────────────────────────
router.post('/admin/status', requireAuth, verifyAdmin, ctrl.updateSiteStatus);
router.post('/admin/announcements', requireAuth, verifyAdmin, ctrl.createAnnouncement);
router.get('/admin/waitlist', requireAuth, verifyAdmin, ctrl.getWaitlist);
router.get('/admin/waitlist/export', requireAuth, verifyAdmin, ctrl.exportWaitlist);

export default router;

