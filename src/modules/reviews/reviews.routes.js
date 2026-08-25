// src/modules/reviews/reviews.routes.js
// Moved from: routes/reviewRoutes.js
import express from 'express';
import {
  createReview, getReviewsByProduct, getReviewStats,
  deleteReview, updateReview, isVerifiedBuyer, getReviewsByUser,
} from './reviews.controller.js';
import { cache } from '../../infrastructure/cache/cache.service.js';
import { makeProductReviewStatsKey, makeVerifiedBuyerKey, makeUserReviewsKey, makeProductReviewsPrefix } from '../../infrastructure/cache/cache.keys.js';
import { requireAuth } from '../../middleware/auth.js';

const router = express.Router();

router.post('/', requireAuth, createReview);
router.get('/:productId', cache((req) => makeProductReviewsPrefix(req.params.productId) + ':limit=' + (req.query.limit || 10) + ':cursor=' + (req.query.cursor || 'none') + ':rating=' + (req.query.rating || 'all'), 3600), getReviewsByProduct);
router.get('/stats/:productId', cache((req) => makeProductReviewStatsKey(req.params.productId), 43200), getReviewStats);
router.get(
  '/verify', requireAuth,
  cache((req) => makeVerifiedBuyerKey(req.auth.userId, req.query.productId), 60),
  (req, res, next) => { req.query.userId = req.auth.userId; req.query.clerkId = req.auth.userId; next(); },
  isVerifiedBuyer
);
router.delete('/:id', requireAuth, deleteReview);
router.put('/:id', requireAuth, updateReview);
router.get('/user/:userId', requireAuth, cache((req) => makeUserReviewsKey(req.params.userId), 3600), getReviewsByUser);

export default router;
