import express from "express";
import multer from "multer";
import * as RewardsController from "./rewards.controller.js";
import { requireAuth, verifyAdmin } from "../../middleware/auth.js";

const router = express.Router();
const upload = multer({ dest: "uploads/" }); 

/* ======================================================
   🟢 PUBLIC/USER ROUTES
====================================================== */
router.get("/config", RewardsController.getConfig);
router.get("/my-history/:userId", requireAuth, RewardsController.getMyHistory);
router.post("/claim", requireAuth, upload.single("proofImage"), RewardsController.claimReward);

/* ======================================================
   🔒 ADMIN ROUTES
====================================================== */
router.post("/config", requireAuth, verifyAdmin, RewardsController.updateConfig);
router.get("/admin/pending", requireAuth, verifyAdmin, RewardsController.getPendingClaims);
router.get("/admin/lottery-history", requireAuth, verifyAdmin, RewardsController.getLotteryHistory);
router.post("/admin/pick-lottery-winner", requireAuth, verifyAdmin, RewardsController.pickLotteryWinner);
router.post("/admin/decide", requireAuth, verifyAdmin, RewardsController.decideClaim);

export default router;
