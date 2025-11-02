// file routes/reviewRoutes.js

import express from "express";
import {
  createReview,
  getReviewsByProduct,
  getReviewStats,
  deleteReview,
  updateReview,
  isVerifiedBuyer,
  getReviewsByUser,
} from "../controllers/reviewController.js";
import { cache } from "../cacheMiddleware.js";
// 🟢 Import new cache key builders
import {
  makeProductReviewStatsKey,
  makeVerifiedBuyerKey,
  makeUserReviewsKey,
} from "../cacheKeys.js";

const router = express.Router();

// POST /api/reviews
// Creates a new review. The controller handles cache invalidation.
router.post("/", createReview);

// GET /api/reviews/:productId
// Caching is handled inside the controller if needed (but removed for pagination)
router.get("/:productId", getReviewsByProduct);

// GET /api/reviews/stats/:productId
// 🟢 Use new cache key builder
router.get(
  "/stats/:productId",
  cache((req) => makeProductReviewStatsKey(req.params.productId), 43200),
  getReviewStats
);

// GET /api/reviews/verify
// 🟢 Use new cache key builder
router.get(
  "/verify",
  cache(
    (req) =>
      makeVerifiedBuyerKey(
        req.query.userId || req.query.clerkId,
        req.query.productId
      ),
    60
  ),
  isVerifiedBuyer
);

// DELETE /api/reviews/:id
// Deletes a review. The controller handles cache invalidation.
router.delete("/:id", deleteReview);

// PUT /api/reviews/:id
// Updates a review. The controller handles cache invalidation.
router.put("/:id", updateReview);

// GET /api/reviews/user/:userId
// 🟢 Use new cache key builder
router.get(
  "/user/:userId",
  cache((req) => makeUserReviewsKey(req.params.userId), 3600),
  getReviewsByUser
);

export default router;