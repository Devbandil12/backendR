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
// 🟢 Add this import to bring in your cache functions
import { cache, invalidateCache } from "../cacheMiddleware.js";

const router = express.Router();

// POST /api/reviews
// 🟢 This route creates a new review, so it should rely on the controller to handle invalidation.
router.post("/", createReview);

// GET /api/reviews/:productId
// 🟢 This route fetches reviews, so it should use the cache middleware.
// The cache key is dynamic, based on product ID and query parameters.
// A TTL of 1 hour (3600 seconds) is a good starting point.
router.get(
  "/:productId",
  cache(
    (req) => `product-reviews:${req.params.productId}:${req.query.rating || 'all'}:${req.query.limit}:${req.query.cursor}`,
    3600
  ),
  getReviewsByProduct
);

// GET /api/reviews/stats/:productId
// 🟢 This route fetches review stats, also a great candidate for caching.
// A longer TTL of 12 hours (43200 seconds) is reasonable.
router.get(
  "/stats/:productId",
  cache((req) => `review-stats:${req.params.productId}`, 43200),
  getReviewStats
);

// GET /api/reviews/verify
// 🟢 This is a read operation, so you can cache it with a short TTL.
// The key is unique for each user and product.
router.get(
  "/verify",
  cache((req) => `verified-buyer:${req.query.userId || req.query.clerkId}:${req.query.productId}`, 60),
  isVerifiedBuyer
);

// DELETE /api/reviews/:id
// 🟢 This route modifies data, so it should rely on the controller to invalidate the cache.
router.delete("/:id", deleteReview);

// PUT /api/reviews/:id
// 🟢 This route updates a review, so it should rely on the controller to invalidate the cache.
router.put("/:id", updateReview);

// GET /api/reviews/user/:userId
// 🟢 This route fetches user reviews. Caching logic is handled inside the controller,
// but you can also apply the middleware here for a cleaner separation of concerns.
router.get(
  "/user/:userId",
  cache((req) => `user-reviews:${req.params.userId}`, 3600),
  getReviewsByUser
);

export default router;
