// ✅ file: routes/bundles.js
import express from "express";
import { db } from "../configs/index.js";
import { 
  productBundlesTable, 
  productVariantsTable, 
  activityLogsTable, 
  usersTable // 🟢 Added for Actor Resolution
} from "../configs/schema.js"; 
import { and, eq } from "drizzle-orm";
import { invalidateMultiple } from "../invalidateHelpers.js";
import { makeAllProductsKey, makeProductKey } from "../cacheKeys.js";

// 🔒 SECURITY: Import Middleware
import { requireAuth, verifyAdmin } from "../middleware/authMiddleware.js";

const router = express.Router();

/**
 * GET /api/bundles/:bundleVariantId
 * Get the contents of a specific bundle (Public for Storefront)
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
 * 🔒 POST /api/bundles (Admin Only)
 * Add an item to a bundle.
 */
router.post("/", requireAuth, verifyAdmin, async (req, res) => {
  const requesterClerkId = req.auth.userId;
  const { bundleVariantId, contentVariantId, quantity, actorId: ignored } = req.body; 

  if (!bundleVariantId || !contentVariantId || !quantity) {
    return res.status(400).json({ error: "bundleVariantId, contentVariantId, and quantity are required." });
  }

  try {
    // 🟢 SECURE: Resolve Actor ID
    const adminUser = await db.query.usersTable.findFirst({
        where: eq(usersTable.clerkId, requesterClerkId),
        columns: { id: true }
    });
    const actorId = adminUser?.id;

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
 * 🔒 DELETE /api/bundles/:bundleEntryId (Admin Only)
 * Remove a single entry (row) from the productBundlesTable
 */
router.delete("/:bundleEntryId", requireAuth, verifyAdmin, async (req, res) => {
  const { bundleEntryId } = req.params;
  const requesterClerkId = req.auth.userId;

  try {
    // 🟢 SECURE: Resolve Actor ID
    const adminUser = await db.query.usersTable.findFirst({
        where: eq(usersTable.clerkId, requesterClerkId),
        columns: { id: true }
    });
    const actorId = adminUser?.id;

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