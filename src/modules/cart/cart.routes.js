import express from "express";
import * as CartController from "./cart.controller.js";
import { requireAuth, withAuth, verifyAdmin } from "../../middleware/auth.js";

const router = express.Router();

/* =========================================================
   🛒 CART ROUTES (Secured)
========================================================= */

router.get("/:userId", requireAuth, CartController.getCart);
router.post("/price-preview", withAuth, CartController.pricePreview);
router.post("/check-serviceability", withAuth, CartController.checkServiceability);
router.post("/", requireAuth, CartController.addToCart);
router.put("/:userId/:variantId", requireAuth, CartController.updateCartQuantity);
router.delete("/:userId/:variantId", requireAuth, CartController.removeCartItem);
router.delete("/:userId", requireAuth, CartController.clearCart);
router.post("/merge", requireAuth, CartController.mergeCart);

/* =========================================================
   🕒 SAVED FOR LATER ROUTES (Secured)
========================================================= */

router.get("/saved-for-later/:userId", requireAuth, CartController.getSavedForLater);
router.post("/save-for-later", requireAuth, CartController.saveForLater);
router.post("/move-to-cart", requireAuth, CartController.moveToCart);
router.delete("/saved-for-later/:userId/:variantId", requireAuth, CartController.removeSavedForLaterItem);

/* =========================================================
   💖 WISHLIST ROUTES (Secured)
========================================================= */

router.get("/wishlist/:userId", requireAuth, CartController.getWishlist);
router.post("/wishlist", requireAuth, CartController.addToWishlist);
router.delete("/wishlist/:userId/:variantId", requireAuth, CartController.removeFromWishlist);
router.post("/wishlist/merge", requireAuth, CartController.mergeWishlist);
router.delete("/wishlist/:userId", requireAuth, CartController.clearWishlist);

/* =========================================================
   👑 ADMIN ROUTES (Secured)
========================================================= */

router.get("/admin/abandoned", requireAuth, verifyAdmin, CartController.getAbandonedCarts);
router.get("/admin/wishlist-stats", requireAuth, verifyAdmin, CartController.getWishlistStats);

/* =========================================================
   🎁 CUSTOM BUNDLES
========================================================= */

router.post("/add-custom-bundle", requireAuth, CartController.addCustomBundle);

export default router;