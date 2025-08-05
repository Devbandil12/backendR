import express from "express";
import {
  createReview,
  getReviewsByProduct,
  getReviewStats,
  deleteReview,
  updateReview,
  isVerifiedBuyer,
} from "../controllers/reviewController.js";

const router = express.Router();

// POST /api/reviews
router.post("/", createReview);

// GET /api/reviews/:productId
router.get("/:productId", getReviewsByProduct);

// GET /api/reviews/stats/:productId
router.get("/stats/:productId", getReviewStats);

// GET /api/reviews/verify?userId=...&productId=...
router.get("/verify", isVerifiedBuyer);

// DELETE /api/reviews/:id
router.delete("/:id", deleteReview);

// PUT /api/reviews/:id
router.put("/:id", updateReview);

export default router;
