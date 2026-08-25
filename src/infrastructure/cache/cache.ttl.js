// src/infrastructure/cache/cache.ttl.js
// Centralised TTL constants (seconds). Replace magic numbers across routes with these.

export const TTL = {
  PRODUCTS_ALL: 300,      // 5 min
  PRODUCT_SINGLE: 300,
  CART: 60,
  WISHLIST: 60,
  ORDERS_ALL: 120,
  ORDER_SINGLE: 120,
  USER_ORDERS: 120,
  COUPONS_ALL: 180,
  COUPON_VALIDATION: 30,
  REVIEWS: 300,
  TESTIMONIALS: 600,      // 10 min
  USER_ADDRESSES: 120,
  NOTIFICATIONS: 30,
};
