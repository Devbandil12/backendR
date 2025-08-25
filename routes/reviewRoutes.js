import express from "express";
import {
  createReview,
  getReviewsByProduct,
  getReviewStats,
  deleteReview,
  updateReview,
  isVerifiedBuyer,
} from "../controllers/reviewController.js";
// 🟢 Add this import to bring in your cache functions
import { cache, invalidateCache } from "../cacheMiddleware.js";

const router = express.Router();

// POST /api/reviews
// 🟢 This route creates a new review, so it should invalidate the cache.
router.post("/", async (req, res, next) => {
  await createReview(req, res, next);
  const { productId } = req.body; // Assuming productId is in the request body
  if (productId) {
    await invalidateCache(`product-reviews:${productId}`);
    await invalidateCache(`review-stats:${productId}`);
  }
});

// GET /api/reviews/:productId
// 🟢 This route fetches reviews, so it should use the cache.
// A TTL of 1 hour (3600 seconds) is a good starting point.
router.get("/:productId", cache("product-reviews", 3600), getReviewsByProduct);

// GET /api/reviews/stats/:productId
// 🟢 This route fetches review stats, also a great candidate for caching.
// A longer TTL of 12 hours (43200 seconds) is reasonable.
router.get("/stats/:productId", cache("review-stats", 43200), getReviewStats);

// GET /api/reviews/verify
// 🟢 This is a read operation, so you can cache it with a short TTL.
// The key will be unique for each user and product.
router.get("/verify", cache("verified-buyer", 60), isVerifiedBuyer);

// DELETE /api/reviews/:id
// 🟢 This route modifies data, so it must invalidate the cache.
// Note: You need to get the productId from the review being deleted.
router.delete("/:id", async (req, res, next) => {
  await deleteReview(req, res, next);
  const { productId } = req.body; // Assuming your controller returns this or you can get it from the request.
  if (productId) {
    await invalidateCache(`product-reviews:${productId}`);
    await invalidateCache(`review-stats:${productId}`);
  }
});

// PUT /api/reviews/:id
// 🟢 This route updates a review, so it must invalidate the cache.
router.put("/:id", async (req, res, next) => {
  await updateReview(req, res, next);
  const { productId } = req.body; // Assuming productId is in the request body
  if (productId) {
    await invalidateCache(`product-reviews:${productId}`);
    await invalidateCache(`review-stats:${productId}`);
  }
});


// GET /api/reviews/user/:userId
router.get("/user/:userId", getReviewsByUser); 


export default router;