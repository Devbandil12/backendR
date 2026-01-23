// ✅ file: routes/variants.js
import express from "express";
import { db } from "../configs/index.js";
import { 
  productVariantsTable, 
  activityLogsTable, 
  usersTable // 🟢 Added for Actor Resolution
} from "../configs/schema.js"; 
import { eq } from "drizzle-orm";
import { invalidateMultiple } from "../invalidateHelpers.js";
import { makeAllProductsKey, makeProductKey } from "../cacheKeys.js";

// 🔒 SECURITY: Import Middleware
import { requireAuth, verifyAdmin } from "../middleware/authMiddleware.js";

const router = express.Router();

/**
 * 🔒 PUT /api/variants/:variantId (Admin Only)
 * Update a single product variant
 */
router.put("/:variantId", requireAuth, verifyAdmin, async (req, res) => {
  const { variantId } = req.params;
  const requesterClerkId = req.auth.userId;
  
  // Destructure data (ignore insecure actorId from body)
  const {
    name, size, oprice, discount, costPrice, stock, sold, sku, isArchived, 
    actorId: ignored 
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
    // 🟢 SECURE: Resolve Actor ID
    const adminUser = await db.query.usersTable.findFirst({
        where: eq(usersTable.clerkId, requesterClerkId),
        columns: { id: true }
    });
    const actorId = adminUser?.id;

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

        if (changes.length > 0) {
            await db.insert(activityLogsTable).values({
                userId: actorId, 
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
 * 🔒 POST /api/variants (Admin Only)
 * Add a new variant
 */
router.post("/", requireAuth, verifyAdmin, async (req, res) => {
  const requesterClerkId = req.auth.userId;
  const { productId, actorId: ignored, ...variantData } = req.body; 

  if (!productId) {
    return res.status(400).json({ error: "productId is required." });
  }

  try {
    // 🟢 SECURE: Resolve Actor ID
    const adminUser = await db.query.usersTable.findFirst({
        where: eq(usersTable.clerkId, requesterClerkId),
        columns: { id: true }
    });
    const actorId = adminUser?.id;

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
 * 🔒 PUT /:variantId/archive (Admin Only)
 */
router.put("/:variantId/archive", requireAuth, verifyAdmin, async (req, res) => {
  const { variantId } = req.params;
  const requesterClerkId = req.auth.userId;

  try {
    // 🟢 SECURE: Resolve Actor ID
    const adminUser = await db.query.usersTable.findFirst({
        where: eq(usersTable.clerkId, requesterClerkId),
        columns: { id: true }
    });
    const actorId = adminUser?.id;

    const [archivedVariant] = await db
      .update(productVariantsTable)
      .set({ isArchived: true }) 
      .where(eq(productVariantsTable.id, variantId))
      .returning();

    if (!archivedVariant) {
      return res.status(404).json({ error: "Variant not found." });
    }

    if (actorId) {
        await db.insert(activityLogsTable).values({
            userId: actorId,
            action: 'VARIANT_ARCHIVE',
            description: `Archived variant: ${archivedVariant.name}`,
            performedBy: 'admin',
            metadata: { variantId, productId: archivedVariant.productId }
        });
    }

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
 * 🔒 PUT /:variantId/unarchive (Admin Only)
 */
router.put("/:variantId/unarchive", requireAuth, verifyAdmin, async (req, res) => {
  const { variantId } = req.params;
  const requesterClerkId = req.auth.userId;

  try {
    // 🟢 SECURE: Resolve Actor ID
    const adminUser = await db.query.usersTable.findFirst({
        where: eq(usersTable.clerkId, requesterClerkId),
        columns: { id: true }
    });
    const actorId = adminUser?.id;

    const [unarchivedVariant] = await db
      .update(productVariantsTable)
      .set({ isArchived: false }) 
      .where(eq(productVariantsTable.id, variantId))
      .returning();

    if (!unarchivedVariant) {
      return res.status(404).json({ error: "Variant not found." });
    }

    if (actorId) {
        await db.insert(activityLogsTable).values({
            userId: actorId,
            action: 'VARIANT_UNARCHIVE',
            description: `Unarchived variant: ${unarchivedVariant.name}`,
            performedBy: 'admin',
            metadata: { variantId, productId: unarchivedVariant.productId }
        });
    }

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