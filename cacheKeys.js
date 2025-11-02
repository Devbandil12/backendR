// cacheKeys.js
// Central place to build cache keys. Import these everywhere.

export const makeAllUsersKey = () => `users:all`;
export const makeFindByClerkIdKey = (clerkId) =>
  `users:find-by-clerk-id:clerkId=${encodeURIComponent(clerkId)}`;
export const makeUserAddressesKey = (userId) =>
  `users:addresses:userId=${encodeURIComponent(userId)}`;

export const makeCartKey = (userId) => `cart:userId=${encodeURIComponent(userId)}`;
export const makeCartCountKey = (userId) => `cart:count:userId=${encodeURIComponent(userId)}`;

export const makeWishlistKey = (userId) => `wishlist:userId=${encodeURIComponent(userId)}`;

export const makeAllOrdersKey = () => `orders:all`;
export const makeOrderKey = (orderId) => `order:details:id=${encodeURIComponent(orderId)}`;
export const makeUserOrdersKey = (userId) => `orders:user:userId=${encodeURIComponent(userId)}`;

export const makeAllProductsKey = () => `products:all`;
export const makeProductKey = (productId) => `product:id=${encodeURIComponent(productId)}`;

export const makeAllCouponsKey = () => `coupons:all`;
export const makeAvailableCouponsKey = (userId) =>
  `coupons:available:userId=${encodeURIComponent(userId)}`;
export const makeCouponValidationKey = (code, userId) =>
  `coupons:validate:code=${encodeURIComponent(code)}:userId=${encodeURIComponent(userId)}`;

export const makeAdminOrdersReportKey = () => `orders:reports:all`;

export const makeProductReviewsPrefix = (productId) =>
  `product:reviews:pid=${encodeURIComponent(productId)}`;
export const makeProductReviewStatsKey = (productId) =>
  `product:reviews:stats:pid=${encodeURIComponent(productId)}`;
export const makeUserReviewsKey = (userId) =>
  `user:reviews:uid=${encodeURIComponent(userId)}`;

// 🟢 ADDED: Key for testimonials
export const makeAllTestimonialsKey = () => `testimonials:all`;

// 🟢 ADDED: Key for review verification check
export const makeVerifiedBuyerKey = (userId, productId) =>
  `verified-buyer:uid=${encodeURIComponent(userId)}:pid=${encodeURIComponent(
    productId
  )}`;