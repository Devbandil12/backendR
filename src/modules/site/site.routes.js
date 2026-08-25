import express from 'express';
import * as ctrl from './site.controller.js';
import { requireAuth, verifyAdmin } from '../../middleware/auth.js';

const router = express.Router();

// ── Public Routes ─────────────────────────────────────────────────────────────
// Highly optimized, cached, unauthenticated endpoint for the frontend
router.get('/status', ctrl.getSiteStatus);
router.get('/announcements', ctrl.getAnnouncements);

// ── Admin Routes ──────────────────────────────────────────────────────────────
router.post('/admin/status', requireAuth, verifyAdmin, ctrl.updateSiteStatus);
router.post('/admin/announcements', requireAuth, verifyAdmin, ctrl.createAnnouncement);

export default router;
