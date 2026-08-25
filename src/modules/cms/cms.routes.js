// src/modules/cms/cms.routes.js
import express from 'express';
import { cache } from '../../infrastructure/cache/cache.service.js';
import { requireAuth, verifyAdmin } from '../../middleware/auth.js';
import * as cmsController from './cms.controller.js';
import { BANNERS_CACHE_KEY, ABOUT_CACHE_KEY } from './cms.service.js';

const router = express.Router();

router.get('/banners', cache(() => BANNERS_CACHE_KEY, 3600), cmsController.getAllBanners);
router.post('/banners', requireAuth, verifyAdmin, cmsController.createBanner);
router.delete('/banners/:id', requireAuth, verifyAdmin, cmsController.deleteBanner);
router.put('/banners/:id', requireAuth, verifyAdmin, cmsController.updateBanner);

router.get('/about', cache(() => ABOUT_CACHE_KEY, 3600), cmsController.getAboutUs);
router.post('/about', requireAuth, verifyAdmin, cmsController.upsertAboutUs);

export default router;
