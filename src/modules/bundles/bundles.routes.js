// src/modules/bundles/bundles.routes.js
import express from 'express';
import { requireAuth, verifyAdmin } from '../../middleware/auth.js';
import * as bundlesController from './bundles.controller.js';

const router = express.Router();

router.get('/:bundleVariantId', bundlesController.getBundleContents);
router.post('/', requireAuth, verifyAdmin, bundlesController.addBundleItem);
router.delete('/:bundleEntryId', requireAuth, verifyAdmin, bundlesController.removeBundleItem);

export default router;
