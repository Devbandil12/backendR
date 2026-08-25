// src/modules/testimonials/testimonials.routes.js
import express from 'express';
import { cache } from '../../infrastructure/cache/cache.service.js';
import { makeAllTestimonialsKey } from '../../infrastructure/cache/cache.keys.js';
import { requireAuth } from '../../middleware/auth.js';
import * as testimonialsController from './testimonials.controller.js';

const router = express.Router();

router.get('/', cache(() => makeAllTestimonialsKey(), 3600), testimonialsController.getAllTestimonials);
router.post('/', requireAuth, testimonialsController.createTestimonial);

export default router;
