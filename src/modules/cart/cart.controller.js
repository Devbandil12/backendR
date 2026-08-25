import * as CartService from "./cart.service.js";
import { calculatePriceBreakdown } from "../checkout/pricing.service.js"; 
import { invalidateMultiple } from "../../infrastructure/cache/cache.invalidate.js";
import * as keys from "../../infrastructure/cache/cache.keys.js";
import { db } from "../../db/client.js";
import { usersTable } from "../../db/schema/index.js";
import { eq } from "drizzle-orm";
import { getServiceability } from "../../infrastructure/shipping/providers/shiprocket.js";
import { redis } from "../../config/redis.js";

const getUserFromToken = async (clerkId) => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
  return user;
};

export const getCart = async (req, res) => {
  try {
    const { userId } = req.params;
    const requester = await getUserFromToken(req.auth.userId);
    if (!requester) return res.status(401).json({ error: "Unauthorized" });

    // 🔒 ACL: Only allow Owner or Admin
    if (requester.id !== userId && requester.role !== 'admin') {
      return res.status(403).json({ error: "Forbidden" });
    }

    const finalItems = await CartService.getCartWithBundles(userId);
    res.json(finalItems);
  } catch (error) {
    console.error("❌ Error fetching cart:", error);
    res.status(500).json({ error: "Server error" });
  }
};

export const pricePreview = async (req, res) => {
  try {
    const { cartItems, couponCode, pincode, userId } = req.body;
    let targetUserId = (!userId || userId === "guest") ? null : userId;
    
    if (req.auth && req.auth.userId) {
      const user = await getUserFromToken(req.auth.userId);
      if (user) {
        targetUserId = user.id;
      }
    }

    const breakdown = await calculatePriceBreakdown(cartItems, couponCode, pincode, targetUserId);
    
    res.json({ 
      success: true, 
      breakdown,
      message: breakdown.rejectionMessage || null 
    });
  } catch (error) {
    res.json({ 
      success: false, 
      error: true, 
      message: error.message, 
      breakdown: null 
    });
  }
};

export const checkServiceability = async (req, res) => {
  try {
    const { pincode } = req.body;
    if (!pincode) return res.status(400).json({ error: "Pincode is required" });

    // 1. Check Redis cache first
    const cacheKey = `shiprocket:svc:${pincode}`;
    if (redis.status === "ready") {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return res.json({ success: true, data: JSON.parse(cached) });
      }
    }

    // 2. Fetch from Shiprocket API
    const pickupPincode = process.env.SHIPROCKET_PICKUP_PINCODE || "110030"; // Fallback to a default if not set
    const svc = await getServiceability({
      pickup_postcode: pickupPincode,
      delivery_postcode: pincode,
      weight: 0.5, // Base default weight for estimation
      cod: 1 // Check if COD is available at all
    });

    const couriers = svc?.data?.available_courier_companies || [];
    const cheapest = couriers.length
      ? couriers.reduce((min, c) => (c.rate < min.rate ? c : min), couriers[0])
      : null;

    if (!cheapest) {
      return res.json({ success: false, message: "No serviceable courier found for this pincode." });
    }

    const responseData = {
      isServiceable: true,
      codAvailable: cheapest.cod === 1,
      estimatedDeliveryDays: cheapest.estimated_delivery_days,
      courierName: cheapest.courier_name
    };

    // 3. Cache for 12 hours (pincode serviceability rarely changes)
    if (redis.status === "ready") {
      await redis.set(cacheKey, JSON.stringify(responseData), "EX", 12 * 60 * 60);
    }

    res.json({ success: true, data: responseData });
  } catch (error) {
    console.error("Error checking serviceability:", error);
    res.json({ success: false, message: "Failed to check serviceability" });
  }
};

export const addToCart = async (req, res) => {
  try {
    const { productId, variantId, quantity } = req.body;
    const user = await getUserFromToken(req.auth.userId);
    if (!user) return res.status(401).json({ error: "User not found" });
    
    if (!productId || !variantId || !quantity) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const resultItem = await CartService.addItemToCart(user.id, variantId, quantity);
    await invalidateMultiple([{ key: keys.makeCartKey(user.id) }]);

    res.json(resultItem);
  } catch (error) {
    console.error("❌ Error adding to cart:", error);
    res.status(500).json({ error: "Server error" });
  }
};

export const updateCartQuantity = async (req, res) => {
  try {
    const { userId, variantId } = req.params;
    const { quantity } = req.body;
    
    const user = await getUserFromToken(req.auth.userId);
    if (!user || user.id !== userId) return res.status(403).json({ error: "Forbidden" });

    await CartService.updateItemQuantity(userId, variantId, quantity);
    await invalidateMultiple([{ key: keys.makeCartKey(userId) }]);

    res.json({ success: true });
  } catch (error) {
    console.error("❌ Error updating cart quantity:", error);
    res.status(500).json({ error: "Server error" });
  }
};

export const removeCartItem = async (req, res) => {
  try {
    const { userId, variantId } = req.params;
    
    const user = await getUserFromToken(req.auth.userId);
    if (!user || user.id !== userId) return res.status(403).json({ error: "Forbidden" });

    await CartService.removeCartItem(userId, variantId);
    await invalidateMultiple([{ key: keys.makeCartKey(userId) }]);

    res.json({ success: true });
  } catch (error) {
    console.error("❌ Error removing cart item:", error);
    res.status(500).json({ error: "Server error" });
  }
};

export const clearCart = async (req, res) => {
  try {
    const { userId } = req.params;
    
    const user = await getUserFromToken(req.auth.userId);
    if (!user || user.id !== userId) return res.status(403).json({ error: "Forbidden" });

    await CartService.clearCart(userId);
    await invalidateMultiple([{ key: keys.makeCartKey(userId) }]);
    
    res.json({ success: true });
  } catch (error) {
    console.error("❌ Error clearing cart:", error);
    res.status(500).json({ error: "Server error" });
  }
};

export const mergeCart = async (req, res) => {
  try {
    const { guestCart } = req.body;
    
    const user = await getUserFromToken(req.auth.userId);
    if (!user) return res.status(401).json({ error: "User not found" });

    if (!Array.isArray(guestCart) || guestCart.length === 0) {
      return res.status(400).json({ error: "Invalid request body" });
    }

    await CartService.mergeGuestCart(user.id, guestCart);
    await invalidateMultiple([{ key: keys.makeCartKey(user.id) }]);
    
    res.json({ success: true, message: "Guest cart merged successfully." });
  } catch (error) {
    console.error("❌ Error merging carts:", error);
    res.status(500).json({ error: "Server error while merging cart." });
  }
};

export const getSavedForLater = async (req, res) => {
  try {
    const { userId } = req.params;
    
    const user = await getUserFromToken(req.auth.userId);
    if (!user || user.id !== userId) return res.status(403).json({ error: "Forbidden" });

    const formatted = await CartService.getSavedForLaterWithBundles(userId);
    res.json(formatted);
  } catch (error) {
    console.error("❌ Error fetching saved items:", error);
    res.status(500).json({ error: "Server error" });
  }
};

export const saveForLater = async (req, res) => {
  try {
    const { variantId, quantity } = req.body;
    
    const user = await getUserFromToken(req.auth.userId);
    if (!user) return res.status(401).json({ error: "User not found" });

    if (!variantId) return res.status(400).json({ error: "Missing variantId" });

    await CartService.saveForLater(user.id, variantId, quantity);
    await invalidateMultiple([{ key: keys.makeCartKey(user.id) }]);
    
    res.json({ success: true });
  } catch (error) {
    console.error("❌ Error saving for later:", error);
    res.status(500).json({ error: "Server error" });
  }
};

export const moveToCart = async (req, res) => {
  try {
    const { variantId, quantity } = req.body;
    
    const user = await getUserFromToken(req.auth.userId);
    if (!user) return res.status(401).json({ error: "User not found" });

    if (!variantId) return res.status(400).json({ error: "Missing variantId" });

    await CartService.moveToCart(user.id, variantId, quantity);
    await invalidateMultiple([{ key: keys.makeCartKey(user.id) }]);
    
    res.json({ success: true });
  } catch (error) {
    console.error("❌ Error moving to cart:", error);
    res.status(500).json({ error: "Server error" });
  }
};

export const removeSavedForLaterItem = async (req, res) => {
  try {
    const { userId, variantId } = req.params;
    
    const user = await getUserFromToken(req.auth.userId);
    if (!user || user.id !== userId) return res.status(403).json({ error: "Forbidden" });

    await CartService.removeSavedForLater(userId, variantId);
    res.json({ success: true });
  } catch (error) {
    console.error("❌ Error removing saved item:", error);
    res.status(500).json({ error: "Server error" });
  }
};

export const getWishlist = async (req, res) => {
  try {
    const { userId } = req.params;
    
    const user = await getUserFromToken(req.auth.userId);
    if (!user || user.id !== userId) return res.status(403).json({ error: "Forbidden" });

    const wishlistItems = await CartService.getWishlistFormatted(userId);
    res.json(wishlistItems);
  } catch (error) {
    console.error("❌ Error fetching wishlist:", error);
    res.status(500).json({ error: "Server error" });
  }
};

export const addToWishlist = async (req, res) => {
  try {
    const { productId, variantId } = req.body;
    
    const user = await getUserFromToken(req.auth.userId);
    if (!user) return res.status(401).json({ error: "User not found" });

    if (!productId || !variantId) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const newItem = await CartService.addToWishlist(user.id, variantId);
    await invalidateMultiple([{ key: keys.makeWishlistKey(user.id) }]);
    
    res.json(newItem);
  } catch (error) {
    console.error("❌ Error adding to wishlist:", error);
    res.status(500).json({ error: "Server error" });
  }
};

export const removeFromWishlist = async (req, res) => {
  try {
    const { userId, variantId } = req.params;
    
    const user = await getUserFromToken(req.auth.userId);
    if (!user || user.id !== userId) return res.status(403).json({ error: "Forbidden" });

    await CartService.removeFromWishlist(userId, variantId);
    await invalidateMultiple([{ key: keys.makeWishlistKey(userId) }]);
    
    res.json({ success: true });
  } catch (error) {
    console.error("❌ Error removing wishlist item:", error);
    res.status(500).json({ error: "Server error" });
  }
};

export const mergeWishlist = async (req, res) => {
  try {
    const { guestWishlist } = req.body;
    
    const user = await getUserFromToken(req.auth.userId);
    if (!user) return res.status(401).json({ error: "User not found" });

    if (!Array.isArray(guestWishlist) || guestWishlist.length === 0) {
      return res.status(400).json({ error: "Invalid request body" });
    }

    await CartService.mergeGuestWishlist(user.id, guestWishlist);
    await invalidateMultiple([{ key: keys.makeWishlistKey(user.id) }]);
    
    res.json({ success: true, message: "Guest wishlist merged successfully." });
  } catch (error) {
    console.error("❌ Error merging wishlist:", error);
    res.status(500).json({ error: "Server error while merging wishlist." });
  }
};

export const clearWishlist = async (req, res) => {
  try {
    const { userId } = req.params;
    
    const user = await getUserFromToken(req.auth.userId);
    if (!user || user.id !== userId) return res.status(403).json({ error: "Forbidden" });

    await CartService.clearWishlist(userId);
    await invalidateMultiple([{ key: keys.makeWishlistKey(userId) }]);
    
    res.json({ success: true });
  } catch (error) {
    console.error("❌ Error clearing wishlist:", error);
    res.status(500).json({ error: "Server error" });
  }
};

export const getAbandonedCarts = async (req, res) => {
  try {
    const abandonedItems = await CartService.getAbandonedCartsAdmin();
    res.json(abandonedItems);
  } catch (error) {
    console.error("❌ Error fetching abandoned carts:", error);
    res.status(500).json({ error: "Server error" });
  }
};

export const getWishlistStats = async (req, res) => {
  try {
    const stats = await CartService.getWishlistStatsAdmin();
    res.json(stats);
  } catch (error) {
    console.error("❌ Error fetching wishlist stats:", error);
    res.status(500).json({ error: "Server error" });
  }
};

export const addCustomBundle = async (req, res) => {
  try {
    const { templateVariantId, contentVariantIds } = req.body;
    
    const user = await getUserFromToken(req.auth.userId);
    if (!user) return res.status(401).json({ error: "User not found" });

    if (!templateVariantId || !Array.isArray(contentVariantIds) || contentVariantIds.length !== 4) {
      return res.status(400).json({ error: "Invalid bundle data." });
    }

    const newCustomBundle = await CartService.createCustomBundle(user.id, templateVariantId, contentVariantIds);
    await invalidateMultiple([{ key: keys.makeCartKey(user.id) }]);
    
    res.status(201).json(newCustomBundle);
  } catch (error) {
    console.error("❌ Error creating custom bundle:", error);
    res.status(500).json({ error: "Server error" });
  }
};
