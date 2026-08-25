import express from "express";
import * as CatalogController from "./catalog.controller.js";
import { cache } from "../../infrastructure/cache/cache.service.js";
import { makeAllProductsKey, makeProductKey } from "../../infrastructure/cache/cache.keys.js";
import { requireAuth, verifyAdmin } from "../../middleware/auth.js";

const router = express.Router();

/* ======================================================
   🟢 PUBLIC ROUTES
====================================================== */
router.get("/", cache(makeAllProductsKey(), 3600), CatalogController.getAllProducts);
// Admin route /archived should be matched before /:id so it's handled properly (not as ID). But since we have requireAuth, we should just move /:id to the bottom.
// Wait, actually I will just move /:id after the public and admin routes that don't take an ID parameter, or just after /archived.

/* ======================================================
   🧠 AURA INTELLIGENCE & RECOMMENDATIONS (Public)
====================================================== */
router.post('/aura-match', CatalogController.auraMatch);
router.post('/recommendations', CatalogController.getRecommendations);

/* ======================================================
   🔒 ADMIN CATALOG ROUTES 
====================================================== */
router.get("/archived", requireAuth, verifyAdmin, CatalogController.getArchivedProducts);
router.post("/", requireAuth, verifyAdmin, CatalogController.createProduct);
router.put("/:id", requireAuth, verifyAdmin, CatalogController.updateProduct);
router.put("/variants/bulk", requireAuth, verifyAdmin, CatalogController.bulkUpdateVariants);
router.put("/:id/archive", requireAuth, verifyAdmin, CatalogController.archiveProduct);
router.put("/:id/unarchive", requireAuth, verifyAdmin, CatalogController.unarchiveProduct);
router.post("/cache/invalidate", requireAuth, verifyAdmin, CatalogController.invalidateCache);

// Move getProductById to the end to avoid matching static paths like /archived
router.get("/:id", cache((req) => makeProductKey(req.params.id), 1800), CatalogController.getProductById);

export default router;
