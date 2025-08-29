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
import { cache } from "../cacheMiddleware.js"; // only need cache here

const router = express.Router();

// POST /api/reviews
// 🟢 Creates a new review. Controller handles cache invalidation.
router.post("/", createReview);

// GET /api/reviews/:productId
// 🟢 Fetch reviews for a product (optionally filtered by rating).
// Cache key depends only on productId + rating (NOT limit/cursor).
router.get(
  "/:productId",
  cache(
    (req) => `product-reviews:${req.params.productId}:${req.query.rating || "all"}`,
    3600
  ),
  getReviewsByProduct
);

// GET /api/reviews/stats/:productId
// 🟢 Fetch review stats (average, counts). Cached longer.
router.get(
  "/stats/:productId",
  cache((req) => `review-stats:${req.params.productId}`, 43200),
  getReviewStats
);

// GET /api/reviews/verify
// 🟢 Check verified buyer. Cache briefly.
router.get(
  "/verify",
  cache(
    (req) =>
      `verified-buyer:${req.query.userId || req.query.clerkId}:${req.query.productId}`,
    60
  ),
  isVerifiedBuyer
);

// DELETE /api/reviews/:id
// 🟢 Deletes a review. Controller handles invalidation.
router.delete("/:id", deleteReview);

// PUT /api/reviews/:id
// 🟢 Updates a review. Controller handles invalidation.
router.put("/:id", updateReview);

// GET /api/reviews/user/:userId
// 🟢 Fetch user’s reviews. Cache by userId.
router.get(
  "/user/:userId",
  cache((req) => `user-reviews:${req.params.userId}`, 3600),
  getReviewsByUser
);

export default router;
