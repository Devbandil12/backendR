// ✅ file: routes/reviewRoutes.js

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
import {
  makeProductReviewStatsKey,
  makeVerifiedBuyerKey,
  makeUserReviewsKey,
} from "../cacheKeys.js";

// 🔒 SECURITY: Import Middleware
import { requireAuth } from "../middleware/authMiddleware.js";

const router = express.Router();

/* ======================================================
   🔒 CREATE REVIEW (Authenticated)
====================================================== */
router.post("/", requireAuth, createReview);

/* ======================================================
   🟢 GET PRODUCT REVIEWS (Public)
====================================================== */
router.get("/:productId", getReviewsByProduct);

/* ======================================================
   🟢 GET REVIEW STATS (Public)
====================================================== */
router.get(
  "/stats/:productId",
  cache((req) => makeProductReviewStatsKey(req.params.productId), 43200),
  getReviewStats
);

/* ======================================================
   🔒 VERIFY BUYER STATUS (Authenticated)
   - Prevents scraping purchase history
====================================================== */
router.get(
  "/verify",
  requireAuth,
  cache(
    (req) =>
      makeVerifiedBuyerKey(
        req.auth.userId, // 🟢 Use secure Token ID instead of query param
        req.query.productId
      ),
    60
  ),
  (req, res, next) => {
      // 🟢 Security Patch: Force query params to match the authenticated user
      // This ensures the controller uses the token's identity, not a spoofed query param
      req.query.userId = req.auth.userId;
      req.query.clerkId = req.auth.userId;
      next();
  },
  isVerifiedBuyer
);

/* ======================================================
   🔒 DELETE REVIEW (Authenticated)
====================================================== */
router.delete("/:id", requireAuth, deleteReview);

/* ======================================================
   🔒 UPDATE REVIEW (Authenticated)
====================================================== */
router.put("/:id", requireAuth, updateReview);

/* ======================================================
   🔒 GET USER REVIEWS (Authenticated)
====================================================== */
router.get(
  "/user/:userId",
  requireAuth,
  cache((req) => makeUserReviewsKey(req.params.userId), 3600),
  getReviewsByUser
);


export default router;