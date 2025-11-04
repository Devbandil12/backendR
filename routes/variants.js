// routes/variants.js
import express from "express";
import { db } from "../configs/index.js";
import { productVariantsTable } from "../configs/schema.js";
import { eq } from "drizzle-orm";
import { invalidateMultiple } from "../invalidateHelpers.js";
import { makeAllProductsKey, makeProductKey } from "../cacheKeys.js";

const router = express.Router();

/**
 * PUT /api/variants/:variantId
 * Update a single product variant (e.g., change stock or price)
 */
router.put("/:variantId", async (req, res) => {
  const { variantId } = req.params;
  
  // Destructure all allowed fields
  const {
    name,
    size,
    oprice,
    discount,
    costPrice,
    stock,
    sold,
    sku,
    isArchived // Allow updating isArchived this way too, just in case
  } = req.body;

  const variantData = {
    name, size, oprice, discount, costPrice, stock, sold, sku, isArchived
  };

  // Remove undefined fields so we don't accidentally set null
  Object.keys(variantData).forEach(key => 
    variantData[key] === undefined && delete variantData[key]
  );

  if (Object.keys(variantData).length === 0) {
    return res.status(400).json({ error: "No valid variant fields to update." });
  }

  try {
    const [updatedVariant] = await db
      .update(productVariantsTable)
      .set(variantData)
      .where(eq(productVariantsTable.id, variantId))
      .returning();

    if (!updatedVariant) {
      return res.status(404).json({ error: "Variant not found." });
    }

    // Invalidate the parent product's cache
    await invalidateMultiple([
      { key: makeAllProductsKey(), prefix: true },
      { key: makeProductKey(updatedVariant.productId), prefix: true },
    ]);

    res.json(updatedVariant);
  } catch (error) {
    console.error("❌ Error updating variant:", error);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/variants
 * Add a new variant to an *existing* product
 */
router.post("/", async (req, res) => {
  const { productId, ...variantData } = req.body;

  if (!productId) {
    return res.status(400).json({ error: "productId is required." });
  }

  try {
    const [newVariant] = await db
      .insert(productVariantsTable)
      .values({
        productId,
        name: variantData.name,
        size: variantData.size,
        oprice: variantData.oprice,
        discount: variantData.discount,
        costPrice: variantData.costPrice,
        stock: variantData.stock,
        sku: variantData.sku,
        // isArchived defaults to false
      })
      .returning();

    // Invalidate the parent product's cache
    await invalidateMultiple([
      { key: makeAllProductsKey(), prefix: true },
      { key: makeProductKey(newVariant.productId), prefix: true },
    ]);

    res.status(201).json(newVariant);
  } catch (error) {
    console.error("❌ Error adding variant:", error);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * 🟢 NEW: PUT to archive a variant
 * This replaces the old DELETE route
 */
router.put("/:variantId/archive", async (req, res) => {
  const { variantId } = req.params;
  try {
    const [archivedVariant] = await db
      .update(productVariantsTable)
      .set({ isArchived: true }) // Set the flag
      .where(eq(productVariantsTable.id, variantId))
      .returning();

    if (!archivedVariant) {
      return res.status(404).json({ error: "Variant not found." });
    }

    // Invalidate the parent product's cache
    await invalidateMultiple([
      { key: makeAllProductsKey(), prefix: true },
      { key: makeProductKey(archivedVariant.productId), prefix: true },
    ]);

    res.json({ success: true, message: "Variant archived." });
  } catch (error) {
    console.error("❌ Error archiving variant:", error);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * 🟢 NEW: PUT to unarchive a variant
 */
router.put("/:variantId/unarchive", async (req, res) => {
  const { variantId } = req.params;
  try {
    const [unarchivedVariant] = await db
      .update(productVariantsTable)
      .set({ isArchived: false }) // Clear the flag
      .where(eq(productVariantsTable.id, variantId))
      .returning();

    if (!unarchivedVariant) {
      return res.status(404).json({ error: "Variant not found." });
    }

    // Invalidate cache
    await invalidateMultiple([
      { key: makeAllProductsKey(), prefix: true },
      { key: makeProductKey(unarchivedVariant.productId), prefix: true },
    ]);

    res.json({ success: true, message: "Variant unarchived." });
  } catch (error) {
    console.error("❌ Error unarchiving variant:", error);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;