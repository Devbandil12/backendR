import * as CartRepository from "./cart.repository.js";
import { addToCartTable, savedForLaterTable, wishlistTable, productVariantsTable, productBundlesTable } from "../../db/schema/index.js";
import { and, eq, inArray } from "drizzle-orm";

export const getCartWithBundles = async (userId) => {
  const cartItems = await CartRepository.getCartItemsByUserId(userId);
  
  const detailedCartItems = await Promise.all(cartItems.map(async (item) => {
    const bundleContents = await CartRepository.getBundleContents(item.variantId);

    if (bundleContents.length > 0) {
      return {
        ...item,
        isBundle: true,
        contents: bundleContents.map(c => ({
          quantity: c.quantity,
          name: c.content.product.name,
          variantName: c.content.name
        }))
      };
    }
    
    return { ...item, isBundle: false };
  }));

  return detailedCartItems.map(item => ({
     quantity: item.quantity,
     cartId: item.id,
     userId: item.userId,
     variant: item.variant,
     product: item.variant.product,
     isBundle: item.isBundle,
     contents: item.contents || []
  }));
};

export const addItemToCart = async (userId, variantId, quantity) => {
  const existingItem = await CartRepository.getCartItem(userId, variantId);
  if (existingItem) {
    return await CartRepository.updateCartItemQuantity(existingItem.id, quantity);
  } else {
    return await CartRepository.insertCartItem(userId, variantId, quantity);
  }
};

export const updateItemQuantity = async (userId, variantId, quantity) => {
  await CartRepository.updateCartQuantityRaw(userId, variantId, quantity);
};

export const removeCartItem = async (userId, variantId) => {
  await CartRepository.removeCartItem(userId, variantId);
};

export const clearCart = async (userId) => {
  await CartRepository.clearCart(userId);
};

export const mergeGuestCart = async (userId, guestCart) => {
  if (!Array.isArray(guestCart) || guestCart.length === 0) return;
  
  await CartRepository.executeTransaction(async (tx) => {
    const guestVariantIds = guestCart.map((item) => item.variantId);
    
    const existingCartItems = await tx
      .select()
      .from(addToCartTable)
      .where(
        and(
          eq(addToCartTable.userId, userId),
          inArray(addToCartTable.variantId, guestVariantIds)
        )
      );

    const existingVariantIds = new Set(existingCartItems.map((item) => item.variantId));

    const promises = guestCart.map((guestItem) => {
      if (existingVariantIds.has(guestItem.variantId)) {
        const existingItem = existingCartItems.find(
          (item) => item.variantId === guestItem.variantId
        );
        const newQuantity = existingItem.quantity + (parseInt(guestItem.quantity, 10) || 1);
        return tx
          .update(addToCartTable)
          .set({ quantity: newQuantity })
          .where(
            and(
              eq(addToCartTable.userId, userId),
              eq(addToCartTable.variantId, guestItem.variantId)
            )
          );
      } else {
        return tx.insert(addToCartTable).values({
          userId,
          variantId: guestItem.variantId, 
          quantity: parseInt(guestItem.quantity, 10) || 1,
        });
      }
    });
    await Promise.all(promises);
  });
};

export const getSavedForLaterWithBundles = async (userId) => {
  const savedItems = await CartRepository.getSavedForLaterItems(userId);
  
  const detailedSavedItems = await Promise.all(savedItems.map(async (item) => {
    const bundleContents = await CartRepository.getBundleContents(item.variantId);

    if (bundleContents.length > 0) {
      return {
        ...item,
        isBundle: true,
        contents: bundleContents.map(c => ({
          quantity: c.quantity,
          name: c.content.product.name,
          variantName: c.content.name
        }))
      };
    }
    return { ...item, isBundle: false, contents: [] };
  }));
  
  return detailedSavedItems.map(item => ({
    ...item,
    product: item.variant.product, 
  }));
};

export const saveForLater = async (userId, variantId, quantity) => {
  const parsedQty = parseInt(quantity, 10) || 1;

  await CartRepository.executeTransaction(async (tx) => {
    await tx.delete(addToCartTable).where(
      and(eq(addToCartTable.userId, userId), eq(addToCartTable.variantId, variantId))
    );

    const existing = await tx.query.savedForLaterTable.findFirst({
      where: and(
        eq(savedForLaterTable.userId, userId),
        eq(savedForLaterTable.variantId, variantId)
      ),
    });

    if (existing) {
      await tx.update(savedForLaterTable)
        .set({ quantity: existing.quantity + parsedQty })
        .where(eq(savedForLaterTable.id, existing.id));
    } else {
      await tx.insert(savedForLaterTable).values({
        userId,
        variantId,
        quantity: parsedQty,
      });
    }
  });
};

export const moveToCart = async (userId, variantId, quantity) => {
  const parsedQty = parseInt(quantity, 10) || 1;

  await CartRepository.executeTransaction(async (tx) => {
    await tx.delete(savedForLaterTable).where(
      and(eq(savedForLaterTable.userId, userId), eq(savedForLaterTable.variantId, variantId))
    );

    const existing = await tx.query.addToCartTable.findFirst({
      where: and(eq(addToCartTable.userId, userId), eq(addToCartTable.variantId, variantId)),
    });

    if (existing) {
      await tx.update(addToCartTable)
        .set({ quantity: existing.quantity + parsedQty })
        .where(eq(addToCartTable.id, existing.id));
    } else {
      await tx.insert(addToCartTable).values({
        userId,
        variantId,
        quantity: parsedQty,
      });
    }
  });
};

export const removeSavedForLater = async (userId, variantId) => {
  await CartRepository.removeSavedForLaterItem(userId, variantId);
};

export const getWishlistFormatted = async (userId) => {
  const rawWishlistItems = await CartRepository.getWishlistItems(userId);
  
  return rawWishlistItems.map(item => {
    const product = item.variant.product;
    const variant = item.variant;

    const soldCount = product.variants 
      ? product.variants.reduce((sum, v) => sum + (v.sold || 0), 0) 
      : 0;
    
    let avgRating = 0;
    if (product.reviews && product.reviews.length > 0) {
        const total = product.reviews.reduce((sum, r) => sum + r.rating, 0);
        avgRating = (total / product.reviews.length).toFixed(1);
    }

    const { variants, reviews, ...cleanProduct } = product;

    return {
        wishlistId: item.id,
        userId: item.userId,
        variantId: item.variantId,
        variant: { ...variant, product: undefined }, 
        product: {
            ...cleanProduct,
            soldCount,
            avgRating 
        }
    };
  });
};

export const addToWishlist = async (userId, variantId) => {
  return await CartRepository.insertWishlistItem(userId, variantId);
};

export const removeFromWishlist = async (userId, variantId) => {
  await CartRepository.removeWishlistItem(userId, variantId);
};

export const clearWishlist = async (userId) => {
  await CartRepository.clearWishlist(userId);
};

export const mergeGuestWishlist = async (userId, guestWishlist) => {
  if (!Array.isArray(guestWishlist) || guestWishlist.length === 0) return;
  
  await CartRepository.executeTransaction(async (tx) => {
    const guestVariantIds = guestWishlist.map(item => item.variantId);
    const existingItems = await tx
      .select({ variantId: wishlistTable.variantId })
      .from(wishlistTable)
      .where(
        and(
          eq(wishlistTable.userId, userId),
          inArray(wishlistTable.variantId, guestVariantIds)
        )
      );

    const existingIds = new Set(existingItems.map((i) => i.variantId));
    const newItems = guestWishlist.filter((item) => !existingIds.has(item.variantId));

    if (newItems.length > 0) {
      await tx.insert(wishlistTable).values(
        newItems.map((item) => ({
          userId,
          variantId: item.variantId, 
        }))
      );
    }
  });
};

export const getAbandonedCartsAdmin = async () => {
  return await CartRepository.getAbandonedCarts();
};

export const getWishlistStatsAdmin = async () => {
  return await CartRepository.getWishlistStats();
};

export const createCustomBundle = async (userId, templateVariantId, contentVariantIds) => {
  return await CartRepository.executeTransaction(async (tx) => {
    const templateVariant = await tx.query.productVariantsTable.findFirst({
      where: eq(productVariantsTable.id, templateVariantId),
    });

    if (!templateVariant) throw new Error("Template variant not found.");

    const [newVariant] = await tx.insert(productVariantsTable).values({
      productId: templateVariant.productId,
      name: `Custom Combo - ${userId.slice(0, 8)}`, 
      size: templateVariant.size,
      oprice: templateVariant.oprice,
      discount: templateVariant.discount,
      costPrice: templateVariant.costPrice,
      stock: 1, 
      isArchived: true, 
    }).returning();

    const bundleEntries = contentVariantIds.map(contentId => ({
      bundleVariantId: newVariant.id,
      contentVariantId: contentId,
      quantity: 1,
    }));
    await tx.insert(productBundlesTable).values(bundleEntries);

    const [cartItem] = await tx.insert(addToCartTable).values({
      userId: userId,
      variantId: newVariant.id,
      quantity: 1,
    }).returning();

    return cartItem;
  });
};
