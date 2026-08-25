import { db } from "../../db/client.js";
import { 
  productsTable, 
  productVariantsTable,
  ordersTable, 
  orderItemsTable, 
  wishlistTable, 
  reviewsTable,
  usersTable 
} from "../../db/schema/index.js"; 
import { eq, inArray, notInArray, desc, sql, and, gt, ne } from "drizzle-orm";
import { audit } from "../../infrastructure/audit/audit.service.js";
import { ACTOR_TYPES } from "../../infrastructure/audit/audit.constants.js";

export const getActiveProductsWithVariants = async () => {
  return await db.query.productsTable.findMany({
    where: eq(productsTable.isArchived, false),
    with: { variants: { where: eq(productVariantsTable.isArchived, false) } },
  });
};

export const getReviewStats = async () => {
  return await db
    .select({
      productId: reviewsTable.productId,
      count: sql`count(*)`,
      avgRating: sql`avg(${reviewsTable.rating})` 
    })
    .from(reviewsTable)
    .groupBy(reviewsTable.productId);
};

export const getArchivedProducts = async () => {
  return await db.query.productsTable.findMany({
    where: eq(productsTable.isArchived, true),
    with: { variants: true },
  });
};

export const getProductById = async (id) => {
  return await db.query.productsTable.findFirst({
    where: and(eq(productsTable.id, id), eq(productsTable.isArchived, false)),
    with: { variants: { where: eq(productVariantsTable.isArchived, false) }, reviews: true },
  });
};

export const getProductByIdRaw = async (id) => {
  return await db.query.productsTable.findFirst({
    where: eq(productsTable.id, id)
  });
};

export const createProductWithVariants = async (productData, variantsToInsert, actorId) => {
  return await db.transaction(async (tx) => {
    const [product] = await tx.insert(productsTable).values({
      name: productData.name,
      description: productData.description,
      composition: productData.composition,
      fragrance: productData.fragrance,
      fragranceNotes: productData.fragranceNotes,
      category: productData.category,
      imageurl: productData.imageurl,
    }).returning();

    const variantsData = variantsToInsert.map((variant) => ({
      ...variant,
      productId: product.id,
    }));

    const insertedVariants = await tx.insert(productVariantsTable).values(variantsData).returning();

    if (actorId) {
      await audit.log({
        actorUserId: actorId,
        actorType: ACTOR_TYPES.ADMIN,
        action: 'PRODUCT_CREATED',
        resourceType: 'PRODUCT',
        resourceId: product.id,
        resourceData: product,
        description: `Created product: ${product.name}`
      }, tx);
    }

    return { ...product, variants: insertedVariants };
  });
};

export const updateProduct = async (id, productData) => {
  const [updatedProduct] = await db
    .update(productsTable)
    .set(productData)
    .where(eq(productsTable.id, id))
    .returning();
  return updatedProduct;
};

export const bulkUpdateVariants = async (updates, actorId) => {
  await db.transaction(async (tx) => {
    for (const update of updates) {
      const { id, ...fields } = update;
      await tx.update(productVariantsTable)
        .set(fields)
        .where(eq(productVariantsTable.id, id));
    }

    if (actorId) {
      await audit.log({
        actorUserId: actorId,
        actorType: ACTOR_TYPES.ADMIN,
        action: 'PRODUCT_BULK_UPDATE',
        resourceDisplayName: `Bulk Update (${updates.length} variants)`,
        description: `Bulk updated ${updates.length} variants (Price/Stock/Logistics)`,
        metadata: { count: updates.length }
      }, tx);
    }
  });
};

export const setProductArchiveStatus = async (id, isArchived, actorId, productName) => {
  const [product] = await db
    .update(productsTable)
    .set({ isArchived })
    .where(eq(productsTable.id, id))
    .returning();

  if (product && actorId) {
    await audit.log({
      actorUserId: actorId,
      actorType: ACTOR_TYPES.ADMIN,
      action: isArchived ? 'PRODUCT_ARCHIVED' : 'PRODUCT_RESTORED',
      resourceType: 'PRODUCT',
      resourceId: id,
      resourceData: product,
      description: `${isArchived ? 'Archived' : 'Unarchived'} product: ${productName || product.name}`
    });
  }

  return product;
};

export const getCandidatesForAuraMatch = async () => {
  return await db.query.productsTable.findMany({
    where: and(
      eq(productsTable.isArchived, false),
      ne(productsTable.category, 'Template')
    ),
    columns: {
      id: true,
      name: true,
      description: true,
      composition: true,
      fragrance: true,
      fragranceNotes: true,
      imageurl: true
    },
    with: {
      variants: {
         columns: { id: true, size: true, oprice: true, discount: true, stock: true },
         where: and(
          eq(productVariantsTable.isArchived, false),
          gt(productVariantsTable.stock, 0)
        )
      }
    }
  });
};

export const getRecentOrdersProductIds = async (userId) => {
  return await db.select({ productId: orderItemsTable.productId })
    .from(orderItemsTable)
    .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
    .where(eq(ordersTable.userId, userId))
    .orderBy(desc(ordersTable.createdAt))
    .limit(10);
};

export const getWishlistProductIds = async (userId) => {
  return await db.select({ productId: productVariantsTable.productId })
    .from(wishlistTable)
    .innerJoin(productVariantsTable, eq(wishlistTable.variantId, productVariantsTable.id))
    .where(eq(wishlistTable.userId, userId));
};

export const getCandidatesForRecommendations = async (excludeIds) => {
  let whereClause = and(
    eq(productsTable.isArchived, false),
    ne(productsTable.category, 'Template') 
  );

  if (excludeIds && excludeIds.length > 0) {
    whereClause = and(
      eq(productsTable.isArchived, false),
      ne(productsTable.category, 'Template'),
      notInArray(productsTable.id, excludeIds)
    );
  }

  return await db.query.productsTable.findMany({
    where: whereClause,
    with: {
      variants: {
        columns: {
          id: true,
          name: true,
          size: true,
          oprice: true,
          discount: true,
          stock: true,
          isArchived: true
        },
        where: and(
          eq(productVariantsTable.isArchived, false),
          gt(productVariantsTable.stock, 0)
        )
      }
    }
  });
};

export const getProductsByIds = async (ids) => {
  if (!ids || ids.length === 0) return [];
  return await db.query.productsTable.findMany({
    where: inArray(productsTable.id, ids),
  });
};

// logActivity removed. Use audit.log instead.
