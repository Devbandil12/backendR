import { db } from "../../db/client.js";
import {
  addToCartTable,
  productsTable,
  productVariantsTable,
  wishlistTable,
  usersTable,
  productBundlesTable,
  savedForLaterTable
} from "../../db/schema/index.js";
import { and, eq, inArray, desc, count, gt, lt, sql } from "drizzle-orm";

export const getCartItemsByUserId = async (userId) => {
  return await db.query.addToCartTable.findMany({
    where: eq(addToCartTable.userId, userId),
    with: {
      variant: { with: { product: true } }
    }
  });
};

export const getBundleContents = async (variantId) => {
  return await db.query.productBundlesTable.findMany({
    where: eq(productBundlesTable.bundleVariantId, variantId),
    with: {
      content: { with: { product: true } }
    }
  });
};

export const getCartItem = async (userId, variantId) => {
  const [existingItem] = await db.select().from(addToCartTable)
    .where(and(
      eq(addToCartTable.userId, userId),
      eq(addToCartTable.variantId, variantId)
    ));
  return existingItem;
};

export const updateCartItemQuantity = async (id, newQuantity) => {
  const [updated] = await db
    .update(addToCartTable)
    .set({ quantity: sql`${addToCartTable.quantity} + ${newQuantity}` })
    .where(eq(addToCartTable.id, id))
    .returning();
  return updated;
};

export const updateCartItemQuantityExact = async (id, quantity) => {
  const [updated] = await db
    .update(addToCartTable)
    .set({ quantity })
    .where(eq(addToCartTable.id, id))
    .returning();
  return updated;
};

export const insertCartItem = async (userId, variantId, quantity) => {
  const [inserted] = await db
    .insert(addToCartTable)
    .values({ userId, variantId, quantity })
    .returning();
  return inserted;
};

export const updateCartQuantityRaw = async (userId, variantId, quantity) => {
  await db
    .update(addToCartTable)
    .set({ quantity })
    .where(
      and(
        eq(addToCartTable.userId, userId),
        eq(addToCartTable.variantId, variantId)
      )
    );
};

export const removeCartItem = async (userId, variantId) => {
  await db
    .delete(addToCartTable)
    .where(
      and(
        eq(addToCartTable.userId, userId),
        eq(addToCartTable.variantId, variantId)
      )
    );
};

export const clearCart = async (userId) => {
  await db.delete(addToCartTable).where(eq(addToCartTable.userId, userId));
};

export const getCartItemsByVariantIds = async (userId, variantIds) => {
  if (!variantIds.length) return [];
  return await db
    .select()
    .from(addToCartTable)
    .where(
      and(
        eq(addToCartTable.userId, userId),
        inArray(addToCartTable.variantId, variantIds)
      )
    );
};

export const getSavedForLaterItems = async (userId) => {
  return await db.query.savedForLaterTable.findMany({
    where: eq(savedForLaterTable.userId, userId),
    with: {
      variant: { with: { product: true } },
    },
  });
};

export const getSavedForLaterItem = async (userId, variantId) => {
  return await db.query.savedForLaterTable.findFirst({
    where: and(
      eq(savedForLaterTable.userId, userId),
      eq(savedForLaterTable.variantId, variantId)
    ),
  });
};

export const getWishlistItems = async (userId) => {
  return await db.query.wishlistTable.findMany({
    where: eq(wishlistTable.userId, userId),
    with: {
      variant: {
        with: {
          product: {
            with: {
              variants: true,
              reviews: true 
            }
          }
        }
      }
    }
  });
};

export const getWishlistItemsByVariantIds = async (userId, variantIds) => {
  if (!variantIds.length) return [];
  return await db
    .select({ variantId: wishlistTable.variantId })
    .from(wishlistTable)
    .where(
      and(
        eq(wishlistTable.userId, userId),
        inArray(wishlistTable.variantId, variantIds)
      )
    );
};

export const insertWishlistItems = async (items) => {
  if (!items.length) return;
  await db.insert(wishlistTable).values(items);
};

export const insertWishlistItem = async (userId, variantId) => {
  const [newItem] = await db
    .insert(wishlistTable)
    .values({ userId, variantId })
    .returning();
  return newItem;
};

export const removeWishlistItem = async (userId, variantId) => {
  await db
    .delete(wishlistTable)
    .where(
      and(
        eq(wishlistTable.userId, userId),
        eq(wishlistTable.variantId, variantId)
      )
    );
};

export const clearWishlist = async (userId) => {
  await db.delete(wishlistTable).where(eq(wishlistTable.userId, userId));
};

export const removeSavedForLaterItem = async (userId, variantId) => {
  await db.delete(savedForLaterTable).where(
    and(eq(savedForLaterTable.userId, userId), eq(savedForLaterTable.variantId, variantId))
  );
};

export const getAbandonedCarts = async () => {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  return await db
    .select({
      cartItem: addToCartTable,
      user: {
        id: usersTable.id,
        name: usersTable.name,
        email: usersTable.email,
      },
      product: productsTable,
      variant: productVariantsTable,
    })
    .from(addToCartTable)
    .innerJoin(usersTable, eq(addToCartTable.userId, usersTable.id))
    .innerJoin(productVariantsTable, eq(addToCartTable.variantId, productVariantsTable.id))
    .innerJoin(productsTable, eq(productVariantsTable.productId, productsTable.id))
    .where(
      and(
        lt(addToCartTable.addedAt, twoHoursAgo),
        gt(addToCartTable.addedAt, thirtyDaysAgo)
      )
    )
    .orderBy(desc(addToCartTable.addedAt));
};

export const getWishlistStats = async () => {
  return await db
    .select({
      productId: productVariantsTable.productId,
      variantId: wishlistTable.variantId,
      productName: productsTable.name,
      variantName: productVariantsTable.name,
      productImage: sql`(${productsTable.imageurl}) ->> 0`.as("productImage"),
      count: count(wishlistTable.variantId),
    })
    .from(wishlistTable)
    .innerJoin(productVariantsTable, eq(wishlistTable.variantId, productVariantsTable.id))
    .innerJoin(productsTable, eq(productVariantsTable.productId, productsTable.id))
    .groupBy(
      productVariantsTable.productId,
      wishlistTable.variantId,
      productsTable.name,
      productVariantsTable.name,
      sql`(${productsTable.imageurl}) ->> 0`
    )
    .orderBy(desc(count(wishlistTable.variantId)))
    .limit(20);
};

export const getVariantById = async (variantId) => {
  return await db.query.productVariantsTable.findFirst({
    where: eq(productVariantsTable.id, variantId),
  });
};

export const executeTransaction = async (callback) => {
  return await db.transaction(callback);
};
