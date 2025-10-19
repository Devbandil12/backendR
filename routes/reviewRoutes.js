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

const router = express.Router();

// POST /api/reviews
// Creates a new review. The controller handles cache invalidation.
router.post("/", createReview);

// GET /api/reviews/:productId
// ✅ FIXED: The cache middleware has been REMOVED from this route.
// This is the crucial change that solves the duplication issue by ensuring
// the pagination cursor is processed by the controller on every request.
router.get("/:productId", getReviewsByProduct);

// GET /api/reviews/stats/:productId
// 🟢 Caching is kept here as this route is not paginated and benefits from it.
router.get(
  "/stats/:productId",
  cache((req) => `review-stats:${req.params.productId}`, 43200),
  getReviewStats
);

// GET /api/reviews/verify
// 🟢 Caching is kept here.
router.get(
  "/verify",
  cache(
    (req) =>
      `verified-buyer:${req.query.userId || req.query.clerkId}:${
        req.query.productId
      }`,
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
// 🟢 Caching is kept here.
router.get(
  "/user/:userId",
  cache((req) => `user-reviews:${req.params.userId}`, 3600),
  getReviewsByUser
);

export default router;