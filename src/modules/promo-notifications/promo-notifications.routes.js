// src/modules/promo-notifications/promo-notifications.routes.js
import express from 'express';
import { cache } from '../../infrastructure/cache/cache.service.js';
import * as promoController from './promo-notifications.controller.js';

const router = express.Router();

router.get('/latest-public', cache(() => 'promos:latest-public', 3600), promoController.getLatestPublicPromos);

export default router;
