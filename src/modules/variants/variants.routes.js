// src/modules/variants/variants.routes.js
import express from 'express';
import { requireAuth, verifyAdmin } from '../../middleware/auth.js';
import * as variantsController from './variants.controller.js';

const router = express.Router();

router.put('/:variantId', requireAuth, verifyAdmin, variantsController.updateVariant);
router.post('/', requireAuth, verifyAdmin, variantsController.createVariant);
router.put('/:variantId/archive', requireAuth, verifyAdmin, variantsController.archiveVariant);
router.put('/:variantId/unarchive', requireAuth, verifyAdmin, variantsController.unarchiveVariant);

export default router;
