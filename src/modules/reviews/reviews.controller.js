// src/modules/reviews/reviews.controller.js
// HTTP layer — delegates to service, handles req/res only.
import * as reviewService from './reviews.service.js';
import { validateCreateReview, validateUpdateReview } from './reviews.validator.js';

export const createReview = async (req, res) => {
  try {
    const validation = validateCreateReview(req.body);
    if (!validation.valid) return res.status(400).json({ error: validation.error });
    const review = await reviewService.createReview(req.auth.userId, req.body);
    res.status(201).json(review);
  } catch (err) {
    console.error('? Failed to create review:', err);
    res.status(err.status || 500).json({ error: err.message || 'Server error' });
  }
};

export const getReviewsByProduct = async (req, res) => {
  try {
    res.json(await reviewService.getReviewsByProduct(req.params.productId, req.query));
  } catch (err) {
    console.error('? Error in getReviewsByProduct:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

export const getReviewStats = async (req, res) => {
  try {
    res.json(await reviewService.getReviewStats(req.params.productId));
  } catch (err) {
    console.error('? Failed to fetch review stats:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

export const deleteReview = async (req, res) => {
  try {
    const deleted = await reviewService.deleteReview(req.auth.userId, req.params.id);
    res.json({ success: true, deleted });
  } catch (err) {
    console.error('? Failed to delete review:', err);
    res.status(err.status || 500).json({ error: err.message || 'Server error' });
  }
};

export const updateReview = async (req, res) => {
  try {
    const validation = validateUpdateReview(req.body);
    if (!validation.valid) return res.status(400).json({ error: validation.error });
    const updated = await reviewService.updateReview(req.auth.userId, req.params.id, req.body);
    res.json({ success: true, updated });
  } catch (err) {
    console.error('? Failed to update review:', err);
    res.status(err.status || 500).json({ error: err.message || 'Server error' });
  }
};

export const isVerifiedBuyer = async (req, res) => {
  try {
    const { userId, clerkId, productId } = req.query;
    const verified = await reviewService.checkIsVerifiedBuyer(userId, clerkId, productId);
    res.json({ verified });
  } catch (err) {
    console.error('? Failed to verify purchase:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

export const getReviewsByUser = async (req, res) => {
  try {
    res.json(await reviewService.getReviewsByUser(req.params.userId));
  } catch (err) {
    console.error('? Error fetching user reviews:', err);
    res.status(500).json({ error: 'Server error' });
  }
};
