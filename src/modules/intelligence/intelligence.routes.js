import { Router } from 'express';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import * as intelController from './intelligence.controller.js';

const router = Router();

// Base path: /api/intelligence

// Group 1: Overview
router.get(
  '/overview',
  requireAuth,
  requirePermission('marketIntel.view'),
  intelController.getOverview
);

// Group 2: Customer & Product
router.get(
  '/customer-product',
  requireAuth,
  requirePermission('marketIntel.view'),
  intelController.getCustomerProduct
);

// Group 3: Market
router.get(
  '/market',
  requireAuth,
  requirePermission('marketIntel.view'),
  intelController.getMarket
);

export default router;
