import express from "express";
import * as ReferralsController from "./referrals.controller.js";
import { requireAuth, verifyAdmin } from "../../middleware/auth.js";

const router = express.Router();

/* ======================================================
   🟢 USER ROUTES
====================================================== */
router.get("/stats/:userId", requireAuth, ReferralsController.getStats);
router.post("/apply", requireAuth, ReferralsController.applyReferralCode);

/* ======================================================
   💎 ADMIN ROUTES
====================================================== */
router.get("/admin/all", requireAuth, verifyAdmin, ReferralsController.getAllReferrals);
router.get("/config", requireAuth, verifyAdmin, ReferralsController.getConfig);
router.post("/config", requireAuth, verifyAdmin, ReferralsController.updateConfig);

export default router;
