// routes/bundles.js
import express from "express";
import { db } from "../configs/index.js";
import { productBundlesTable, productVariantsTable, activityLogsTable } from "../configs/schema.js"; // 🟢 Added activityLogsTable
import { and, eq } from "drizzle-orm";
import { invalidateMultiple } from "../invalidateHelpers.js";
import { makeAllProductsKey, makeProductKey } from "../cacheKeys.js";

const router = express.Router();

/**
 * GET /api/bundles/:bundleVariantId
 * Get the contents of a specific bundle
 * (Unchanged)
 */
router.get("/:bundleVariantId", async (req, res) => {
  const { bundleVariantId } = req.params;
  try {
    const bundleContents = await db.query.productBundlesTable.findMany({
      where: eq(productBundlesTable.bundleVariantId, bundleVariantId),
      with: {
        content: true, 
      },
    });

    if (!bundleContents) {
      return res.status(404).json({ error: "Bundle not found or is empty." });
    }
    res.json(bundleContents);
  } catch (error) {
    console.error("❌ Error fetching bundle contents:", error);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * 🟢 POST /api/bundles (Modified for Logging)
 * Add an item to a bundle.
 */
router.post("/", async (req, res) => {
  const { bundleVariantId, contentVariantId, quantity, actorId } = req.body; // 🟢 Extract actorId

  if (!bundleVariantId || !contentVariantId || !quantity) {
    return res.status(400).json({ error: "bundleVariantId, contentVariantId, and quantity are required." });
  }

  try {
    // 1. Fetch details for logging (Names are better than IDs)
    const [bundleVariant, contentVariant] = await Promise.all([
        db.query.productVariantsTable.findFirst({ where: eq(productVariantsTable.id, bundleVariantId) }),
        db.query.productVariantsTable.findFirst({ where: eq(productVariantsTable.id, contentVariantId) })
    ]);

    // 2. Insert Entry
    const [newBundleEntry] = await db
      .insert(productBundlesTable)
      .values({
        bundleVariantId,
        contentVariantId,
        quantity,
      })
      .returning();

    // 🟢 LOG ACTIVITY
    if (actorId) {
        await db.insert(activityLogsTable).values({
            userId: actorId, // Admin ID
            action: 'BUNDLE_ADD_ITEM',
            description: `Added ${quantity}x ${contentVariant?.name || 'Item'} to bundle ${bundleVariant?.name || 'Bundle'}`,
            performedBy: 'admin',
            metadata: { 
                bundleVariantId, 
                contentVariantId, 
                quantity,
                bundleName: bundleVariant?.name,
                contentName: contentVariant?.name
            }
        });
    }

    // Invalidate the product cache for the *bundle's* parent product
    if (bundleVariant) {
        await invalidateMultiple([
            { key: makeAllProductsKey(), prefix: true },
            { key: makeProductKey(bundleVariant.productId), prefix: true },
        ]);
    }

    res.status(201).json(newBundleEntry);
  } catch (error) {
    console.error("❌ Error adding to bundle:", error);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * 🟢 DELETE /api/bundles/:bundleEntryId (Modified for Logging)
 * Remove a single entry (row) from the productBundlesTable
 */
router.delete("/:bundleEntryId", async (req, res) => {
  const { bundleEntryId } = req.params;
  const { actorId } = req.body; // 🟢 Extract actorId

  try {
    // 1. Fetch entry details BEFORE deletion to get names for the log
    const entryToDelete = await db.query.productBundlesTable.findFirst({
        where: eq(productBundlesTable.id, bundleEntryId),
        with: {
            bundle: true,  // Get Bundle Variant details
            content: true  // Get Content Variant details
        }
    });

    if (!entryToDelete) {
      return res.status(404).json({ error: "Bundle entry not found." });
    }

    // 2. Delete
    await db
      .delete(productBundlesTable)
      .where(eq(productBundlesTable.id, bundleEntryId));

    // 🟢 LOG ACTIVITY
    if (actorId) {
        await db.insert(activityLogsTable).values({
            userId: actorId,
            action: 'BUNDLE_REMOVE_ITEM',
            description: `Removed ${entryToDelete.quantity}x ${entryToDelete.content?.name} from bundle ${entryToDelete.bundle?.name}`,
            performedBy: 'admin',
            metadata: { 
                bundleEntryId,
                bundleVariantId: entryToDelete.bundleVariantId,
                contentVariantId: entryToDelete.contentVariantId
            }
        });
    }

    // Invalidate cache
    if (entryToDelete.bundle) {
        await invalidateMultiple([
            { key: makeAllProductsKey(), prefix: true },
            { key: makeProductKey(entryToDelete.bundle.productId), prefix: true },
        ]);
    }

    res.json({ success: true, deletedEntry: entryToDelete });
  } catch (error) {
    console.error("❌ Error removing from bundle:", error);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;