import express from 'express';
import * as AnalyticsController from './analytics.controller.js';
import { requireAuth, verifyAdmin } from '../../middleware/auth.js';

const router = express.Router();

router.get('/admin/funnel-stats', requireAuth, verifyAdmin, AnalyticsController.getFunnelStats);
router.get('/admin/top-returned', requireAuth, verifyAdmin, AnalyticsController.getTopReturnedProducts);

router.get('/admin/sales', requireAuth, verifyAdmin, AnalyticsController.getSalesAnalytics);
router.get('/admin/customers', requireAuth, verifyAdmin, AnalyticsController.getCustomerAnalytics);
router.get('/admin/products', requireAuth, verifyAdmin, AnalyticsController.getProductAnalytics);
router.get('/admin/inventory', requireAuth, verifyAdmin, AnalyticsController.getInventoryAnalytics);

export default router;
