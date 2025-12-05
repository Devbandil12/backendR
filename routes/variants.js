// routes/variants.js
import express from "express";
import { db } from "../configs/index.js";
import { productVariantsTable, activityLogsTable } from "../configs/schema.js"; // 🟢 Added activityLogsTable
import { eq } from "drizzle-orm";
import { invalidateMultiple } from "../invalidateHelpers.js";
import { makeAllProductsKey, makeProductKey } from "../cacheKeys.js";

const router = express.Router();

/**
 * 🟢 PUT /api/variants/:variantId (Modified for Logging)
 * Update a single product variant
 */
router.put("/:variantId", async (req, res) => {
  const { variantId } = req.params;
  
  // Destructure actorId separate from data
  const {
    name, size, oprice, discount, costPrice, stock, sold, sku, isArchived, 
    actorId // 🟢 Extract actorId
  } = req.body;

  const variantData = { name, size, oprice, discount, costPrice, stock, sold, sku, isArchived };

  // Remove undefined fields
  Object.keys(variantData).forEach(key => 
    variantData[key] === undefined && delete variantData[key]
  );

  if (Object.keys(variantData).length === 0) {
    return res.status(400).json({ error: "No valid variant fields to update." });
  }

  try {
    // 1. Fetch current variant for comparison
    const currentVariant = await db.query.productVariantsTable.findFirst({
        where: eq(productVariantsTable.id, variantId)
    });

    if (!currentVariant) return res.status(404).json({ error: "Variant not found." });

    // 2. Update
    const [updatedVariant] = await db
      .update(productVariantsTable)
      .set(variantData)
      .where(eq(productVariantsTable.id, variantId))
      .returning();

    // 🟢 LOG ACTIVITY
    if (actorId) {
        const changes = [];
        if (variantData.oprice && variantData.oprice !== currentVariant.oprice) changes.push("Price");
        if (variantData.stock && variantData.stock !== currentVariant.stock) changes.push("Stock");
        if (variantData.name && variantData.name !== currentVariant.name) changes.push("Name");
        // Add more comparisons as needed

        if (changes.length > 0) {
            await db.insert(activityLogsTable).values({
                userId: actorId, // Admin ID
                action: 'VARIANT_UPDATE',
                description: `Updated variant ${updatedVariant.name}: ${changes.join(', ')}`,
                performedBy: 'admin',
                metadata: { variantId: updatedVariant.id, productId: updatedVariant.productId, changes }
            });
        }
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
 * 🟢 POST /api/variants (Modified for Logging)
 * Add a new variant
 */
router.post("/", async (req, res) => {
  const { productId, actorId, ...variantData } = req.body; // 🟢 Extract actorId

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
      })
      .returning();

    // 🟢 LOG ACTIVITY
    if (actorId) {
        await db.insert(activityLogsTable).values({
            userId: actorId,
            action: 'VARIANT_CREATE',
            description: `Created variant: ${newVariant.name}`,
            performedBy: 'admin',
            metadata: { variantId: newVariant.id, productId }
        });
    }

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
 * 🟢 PUT /:variantId/archive (Modified for Logging)
 */
router.put("/:variantId/archive", async (req, res) => {
  const { variantId } = req.params;
  const { actorId } = req.body; // 🟢 Extract actorId

  try {
    const [archivedVariant] = await db
      .update(productVariantsTable)
      .set({ isArchived: true }) 
      .where(eq(productVariantsTable.id, variantId))
      .returning();

    if (!archivedVariant) {
      return res.status(404).json({ error: "Variant not found." });
    }

    // 🟢 LOG ACTIVITY
    if (actorId) {
        await db.insert(activityLogsTable).values({
            userId: actorId,
            action: 'VARIANT_ARCHIVE',
            description: `Archived variant: ${archivedVariant.name}`,
            performedBy: 'admin',
            metadata: { variantId, productId: archivedVariant.productId }
        });
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
 * 🟢 PUT /:variantId/unarchive (Modified for Logging)
 */
router.put("/:variantId/unarchive", async (req, res) => {
  const { variantId } = req.params;
  const { actorId } = req.body; // 🟢 Extract actorId

  try {
    const [unarchivedVariant] = await db
      .update(productVariantsTable)
      .set({ isArchived: false }) 
      .where(eq(productVariantsTable.id, variantId))
      .returning();

    if (!unarchivedVariant) {
      return res.status(404).json({ error: "Variant not found." });
    }

    // 🟢 LOG ACTIVITY
    if (actorId) {
        await db.insert(activityLogsTable).values({
            userId: actorId,
            action: 'VARIANT_UNARCHIVE',
            description: `Unarchived variant: ${unarchivedVariant.name}`,
            performedBy: 'admin',
            metadata: { variantId, productId: unarchivedVariant.productId }
        });
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