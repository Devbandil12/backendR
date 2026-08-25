import * as CatalogService from "./catalog.service.js";
import { invalidateMultiple } from "../../infrastructure/cache/cache.invalidate.js";
import { makeAllProductsKey, makeProductKey } from "../../infrastructure/cache/cache.keys.js";
import { db } from "../../db/client.js";
import { usersTable } from "../../db/schema/index.js";
import { eq } from "drizzle-orm";

const getUserFromToken = async (clerkId) => {
  if (!clerkId) return null;
  const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.clerkId, clerkId));
  return user;
};

export const getAllProducts = async (req, res) => {
  try {
    const enrichedProducts = await CatalogService.getEnrichedActiveProducts();
    res.json(enrichedProducts);
  } catch (error) {
    console.error("❌ Error fetching products:", error);
    res.status(500).json({ error: "Server error" });
  }
};

export const getArchivedProducts = async (req, res) => {
  try {
    const archivedProducts = await CatalogService.getArchivedProducts();
    res.json(archivedProducts);
  } catch (error) {
    console.error("❌ Error fetching archived products:", error);
    res.status(500).json({ error: "Server error", details: error.message, stack: error.stack });
  }
};

export const getProductById = async (req, res) => {
  try {
    const { id } = req.params;
    const product = await CatalogService.getProductDetails(id);

    if (!product) return res.status(404).json({ error: "Product not found" });

    res.json(product);
  } catch (error) {
    console.error("❌ Error fetching product:", error);
    res.status(500).json({ error: "Server error" });
  }
};

export const createProduct = async (req, res) => {
  try {
    const { variants, actorId: ignored, ...productData } = req.body; 
    
    const adminUser = await getUserFromToken(req.auth.userId);
    const actorId = adminUser?.id;

    const newProduct = await CatalogService.createProduct(productData, variants, actorId);

    await invalidateMultiple([
      { key: makeAllProductsKey(), prefix: true },
      { key: makeProductKey(newProduct.id), prefix: true },
    ]);

    res.status(201).json(newProduct);
  } catch (error) {
    console.error("❌ Error adding product:", error);
    if (error.message.includes("must have at least one variant")) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: "Server error" });
  }
};

export const updateProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      variants, oprice, discount, size, stock,
      costPrice, sold, sku, isArchived, actorId: ignored, 
      weight, length, breadth, height, 
      ...productData
    } = req.body;

    const adminUser = await getUserFromToken(req.auth.userId);
    const actorId = adminUser?.id;

    const updatedProduct = await CatalogService.updateProduct(id, productData, variants, actorId);

    await invalidateMultiple([
      { key: makeAllProductsKey(), prefix: true },
      { key: makeProductKey(id), prefix: true },
    ]);

    res.json(updatedProduct);
  } catch (error) {
    console.error("❌ Error updating product:", error);
    if (error.message === "Product not found.") {
       return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: "Server error" });
  }
};

export const bulkUpdateVariants = async (req, res) => {
  try {
    const { updates } = req.body; 
    
    const adminUser = await getUserFromToken(req.auth.userId);
    const actorId = adminUser?.id;

    await CatalogService.bulkUpdateVariants(updates, actorId);

    await invalidateMultiple([
      { key: makeAllProductsKey(), prefix: true }
    ]);

    res.json({ success: true, message: `Successfully updated ${updates.length} variants.` });
  } catch (error) {
    console.error("❌ Bulk Update Error:", error);
    if (error.message === "No updates provided.") {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: "Server error during bulk update" });
  }
};

export const archiveProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const adminUser = await getUserFromToken(req.auth.userId);
    const actorId = adminUser?.id;

    const archivedProduct = await CatalogService.archiveProduct(id, actorId);

    await invalidateMultiple([
      { key: makeAllProductsKey(), prefix: true },
      { key: makeProductKey(id), prefix: true },
    ]);

    res.json({ success: true, archivedProduct });
  } catch (error) {
    console.error("❌ Error archiving product:", error);
    if (error.message === "Product not found.") {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: "Server error" });
  }
};

export const unarchiveProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const adminUser = await getUserFromToken(req.auth.userId);
    const actorId = adminUser?.id;

    const unarchivedProduct = await CatalogService.unarchiveProduct(id, actorId);

    await invalidateMultiple([
      { key: makeAllProductsKey(), prefix: true },
      { key: makeProductKey(id), prefix: true },
    ]);

    res.json({ success: true, unarchivedProduct });
  } catch (error) {
    console.error("❌ Error unarchiving product:", error);
    if (error.message === "Product not found.") {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: "Server error" });
  }
};

export const invalidateCache = async (req, res) => {
  try {
    await invalidateMultiple([
      { key: makeAllProductsKey(), prefix: true }
    ]);
    res.json({ success: true, message: "Product cache invalidated." });
  } catch (error) {
    console.error("❌ Error invalidating cache:", error);
    res.status(500).json({ error: "Server error" });
  }
};

export const auraMatch = async (req, res) => {
  try {
    const { occasion, vibe } = req.body;
    const bestMatch = await CatalogService.getAuraMatch(occasion, vibe);
    res.json(bestMatch);
  } catch (error) {
    console.error("❌ Aura Match Error:", error);
    if (error.message === "No products available") {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: "Server error during calculation" });
  }
};

export const getRecommendations = async (req, res) => {
  try {
    const { excludeIds } = req.body; 
    let safeDbUserId = null;
    if (req.auth && req.auth.userId) {
      const user = await getUserFromToken(req.auth.userId);
      safeDbUserId = user ? user.id : null;
    }

    const recommendations = await CatalogService.getRecommendations(excludeIds, safeDbUserId);
    res.json(recommendations);
  } catch (error) {
    console.error("Recommend Error:", error);
    res.json([]);
  }
};
