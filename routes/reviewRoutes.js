import express from "express";
import { createReview, getReviewsByProduct, getReviewStats } from "../controllers/reviewController.js";

const router = express.Router();

// POST /api/reviews
router.post("/", createReview);

// GET /api/reviews/:productId
router.get("/:productId", getReviewsByProduct);

// GET /api/reviews/stats/:productId
router.get("/stats/:productId", getReviewStats);

export default router;
