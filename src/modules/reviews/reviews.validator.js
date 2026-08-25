// src/modules/reviews/reviews.validator.js
// Input validation helpers for the reviews module.

/**
 * Validates the body of a create/update review request.
 * Returns { valid: true } or { valid: false, error: string }
 */
export function validateCreateReview(body) {
  const { rating, comment, productId } = body;
  if (!productId) return { valid: false, error: 'productId is required.' };
  if (!rating || isNaN(parseInt(rating)) || parseInt(rating) < 1 || parseInt(rating) > 5) {
    return { valid: false, error: 'rating must be an integer between 1 and 5.' };
  }
  if (!comment || typeof comment !== 'string' || comment.trim().length < 3) {
    return { valid: false, error: 'comment must be at least 3 characters.' };
  }
  if (body.photoUrls !== undefined && !Array.isArray(body.photoUrls)) {
    return { valid: false, error: 'photoUrls must be an array.' };
  }
  return { valid: true };
}

export function validateUpdateReview(body) {
  const { rating, comment } = body;
  if (rating !== undefined && (isNaN(parseInt(rating)) || parseInt(rating) < 1 || parseInt(rating) > 5)) {
    return { valid: false, error: 'rating must be an integer between 1 and 5.' };
  }
  if (comment !== undefined && (typeof comment !== 'string' || comment.trim().length < 3)) {
    return { valid: false, error: 'comment must be at least 3 characters.' };
  }
  return { valid: true };
}
