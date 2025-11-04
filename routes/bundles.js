import express from "express";
import { db } from "../configs/index.js";
import { productBundlesTable, productVariantsTable } from "../configs/schema.js";
import { and, eq } from "drizzle-orm";
import { invalidateMultiple } from "../invalidateHelpers.js";
import { makeAllProductsKey, makeProductKey } from "../cacheKeys.js";

const router = express.Router();

/**
 * GET /api/bundles/:bundleVariantId
 * Get the contents of a specific bundle
 */
router.get("/:bundleVariantId", async (req, res) => {
  const { bundleVariantId } = req.params;
  try {
    const bundleContents = await db.query.productBundlesTable.findMany({
      where: eq(productBundlesTable.bundleVariantId, bundleVariantId),
      with: {
        content: true, // Show the full variant object for each content item
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
 * POST /api/bundles
 * Add an item to a bundle.
 * (e.g., Add 2 "20ml" variants to the "Combo Pack" variant)
 */
router.post("/", async (req, res) => {
  const { bundleVariantId, contentVariantId, quantity } = req.body;

  if (!bundleVariantId || !contentVariantId || !quantity) {
    return res.status(400).json({ error: "bundleVariantId, contentVariantId, and quantity are required." });
  }

  try {
    const [newBundleEntry] = await db
      .insert(productBundlesTable)
      .values({
        bundleVariantId,
        contentVariantId,
        quantity,
      })
      .returning();

    // We must invalidate the product cache for the *bundle's* parent product
    const bundleVariant = await db.query.productVariantsTable.findFirst({
        where: eq(productVariantsTable.id, bundleVariantId),
        columns: { productId: true }
    });

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
 * DELETE /api/bundles/:bundleEntryId
 * Remove a single entry (row) from the productBundlesTable
 */
router.delete("/:bundleEntryId", async (req, res) => {
  const { bundleEntryId } = req.params;

  try {
    const [deletedEntry] = await db
      .delete(productBundlesTable)
      .where(eq(productBundlesTable.id, bundleEntryId))
      .returning();

    if (!deletedEntry) {
      return res.status(404).json({ error: "Bundle entry not found." });
    }

    // Invalidate the parent product's cache
    const bundleVariant = await db.query.productVariantsTable.findFirst({
        where: eq(productVariantsTable.id, deletedEntry.bundleVariantId),
        columns: { productId: true }
    });

    if (bundleVariant) {
        await invalidateMultiple([
            { key: makeAllProductsKey(), prefix: true },
            { key: makeProductKey(bundleVariant.productId), prefix: true },
        ]);
    }

    res.json({ success: true, deletedEntry });
  } catch (error) {
    console.error("❌ Error removing from bundle:", error);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;