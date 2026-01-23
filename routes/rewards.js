// ✅ file: routes/rewards.js
import express from "express";
import multer from "multer";
import { createWorker } from "tesseract.js";
import fs from 'fs'; // Kept for file cleanup only
// import path from 'path'; // REMOVED (No longer needed for config)
import { db } from "../configs/index.js";
// 🟢 Added rewardConfigTable
import { usersTable, walletTransactionsTable, rewardClaimsTable, reviewsTable, rewardConfigTable } from "../configs/schema.js";
import { eq, and, desc, sql } from "drizzle-orm";

// 🔒 SECURITY: Import Middleware
import { requireAuth, verifyAdmin } from "../middleware/authMiddleware.js";

const router = express.Router();
const upload = multer({ dest: "uploads/" }); 

// ==========================================
// ⚡ 1. DYNAMIC CONFIG SYSTEM (DB-Based)
// ==========================================

// Helper: Get Config from DB
const getRewardValues = async () => {
  try {
    const config = await db.select().from(rewardConfigTable).limit(1);
    if (config.length > 0) {
      return {
        paparazzi: config[0].paparazzi ?? 20,
        loyal_follower: config[0].loyal_follower ?? 20,
        reviewer: config[0].reviewer ?? 10,
        monthly_lottery: config[0].monthly_lottery ?? 100
      };
    }
    return { paparazzi: 20, loyal_follower: 20, reviewer: 10, monthly_lottery: 100 }; // Defaults
  } catch (err) {
    console.error("Reward Config Read Error:", err);
    return { paparazzi: 20, loyal_follower: 20, reviewer: 10, monthly_lottery: 100 };
  }
};

/* ======================================================
   🟢 GET CONFIG (Public)
====================================================== */
router.get("/config", async (req, res) => {
  try {
    const config = await getRewardValues();
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch config" });
  }
});

/* ======================================================
   🔒 UPDATE CONFIG (Admin Only)
====================================================== */
router.post("/config", requireAuth, verifyAdmin, async (req, res) => {
  const { paparazzi, loyal_follower, reviewer, monthly_lottery } = req.body;
  if (!paparazzi || !loyal_follower || !reviewer || !monthly_lottery) {
    return res.status(400).json({ error: "Missing values" });
  }

  try {
    const existing = await db.select().from(rewardConfigTable).limit(1);
    
    if (existing.length === 0) {
        await db.insert(rewardConfigTable).values({
            paparazzi: parseInt(paparazzi),
            loyal_follower: parseInt(loyal_follower),
            reviewer: parseInt(reviewer),
            monthly_lottery: parseInt(monthly_lottery)
        });
    } else {
        await db.update(rewardConfigTable)
            .set({
                paparazzi: parseInt(paparazzi),
                loyal_follower: parseInt(loyal_follower),
                reviewer: parseInt(reviewer),
                monthly_lottery: parseInt(monthly_lottery),
                updatedAt: new Date()
            })
            .where(eq(rewardConfigTable.id, existing[0].id));
    }

    res.json({ success: true, config: req.body });
  } catch (error) {
    console.error("Reward Config Save Error:", error);
    res.status(500).json({ error: "Database error" });
  }
});

/* ======================================================
   🔒 GET USER HISTORY (Owner Only)
====================================================== */
router.get("/my-history/:userId", requireAuth, async (req, res) => {
    try {
      const { userId } = req.params;
      const requesterClerkId = req.auth.userId;

      // 1. Resolve Requester
      const requester = await db.query.usersTable.findFirst({
          where: eq(usersTable.clerkId, requesterClerkId),
          columns: { id: true, role: true }
      });
      if (!requester) return res.status(401).json({ error: "Unauthorized" });

      // 🔒 2. OWNERSHIP CHECK
      if (userId !== requester.id && requester.role !== 'admin') {
          return res.status(403).json({ error: "Forbidden" });
      }

      const claims = await db.query.rewardClaimsTable.findMany({
        where: eq(rewardClaimsTable.userId, userId),
        orderBy: [desc(rewardClaimsTable.createdAt)]
      });
      res.json({ success: true, data: claims });
    } catch (error) {
      console.error("History Fetch Error:", error);
      res.status(500).json({ error: "Failed to fetch history" });
    }
});

/* ======================================================
   🔒 CLAIM REWARD (User Only)
   - Uses Token Identity
====================================================== */
router.post("/claim", requireAuth, upload.single("proofImage"), async (req, res) => {
  let tempFilePath = null;
  
  try {
    // 🟢 Fetch dynamic rewards from DB
    const REWARDS = await getRewardValues(); 

    const { taskType, handle } = req.body; 
    const requesterClerkId = req.auth.userId;
    
    const file = req.file;
    tempFilePath = file ? file.path : null;

    if (!taskType) return res.status(400).json({ error: "Missing task type" });

    // Resolve User
    const user = await db.query.usersTable.findFirst({
        where: eq(usersTable.clerkId, requesterClerkId)
    });
    if (!user) return res.status(404).json({ error: "User not found" });
    const userId = user.id;

    // A. DUPLICATE CHECK (Prevent Spam)
    if (taskType !== 'monthly_lottery') {
        const existing = await db.query.rewardClaimsTable.findFirst({
            where: and(
                eq(rewardClaimsTable.userId, userId),
                eq(rewardClaimsTable.taskType, taskType),
                sql`${rewardClaimsTable.status} != 'rejected'` 
            )
        });
        if (existing) {
            return res.status(400).json({ error: "You have already completed or submitted this task!" });
        }
    } else {
        const recentEntry = await db.query.rewardClaimsTable.findFirst({
            where: and(
                eq(rewardClaimsTable.userId, userId),
                eq(rewardClaimsTable.taskType, 'monthly_lottery'),
                sql`${rewardClaimsTable.createdAt} > NOW() - INTERVAL '30 days'`
            )
        });
        if (recentEntry) {
            return res.status(400).json({ error: "You are already entered for this month!" });
        }
    }

    let status = "pending";
    let rewardAmount = REWARDS[taskType] || 0;
    let adminNote = "Manual Review Required";
    let proofData = file ? file.filename : (handle || "Manual Check");

    // B. AI / AUTOMATED CHECKS
    if (file && (taskType === 'paparazzi' || taskType === 'loyal_follower')) {
        try {
            const worker = await createWorker('eng');
            const { data: { text } } = await worker.recognize(tempFilePath);
            await worker.terminate();
            const lowerText = text.toLowerCase();
            
            if (taskType === 'loyal_follower' && (lowerText.includes('following') || lowerText.includes('message'))) {
                adminNote = "AI Confidence: High (Text 'Following' found)";
            } else if (taskType === 'paparazzi' && (lowerText.includes('view') || lowerText.includes('seen'))) {
                adminNote = "AI Confidence: Medium (Views detected)";
            }
        } catch (e) {
            console.log("OCR Skipped:", e.message);
        }
    }

    // C. INSTANT VERIFICATION FOR REVIEWS
    if (taskType === 'reviewer') {
        const review = await db.query.reviewsTable.findFirst({
            where: and(
                eq(reviewsTable.userId, userId), 
                sql`array_length(${reviewsTable.photoUrls}, 1) > 0`,
                eq(reviewsTable.isVerifiedBuyer, true)
            ),
            orderBy: [desc(reviewsTable.createdAt)]
        });

        if (review) {
            status = "approved"; 
            adminNote = `System Verified: Review ID ${review.id} (Verified Buyer)`;
            proofData = `Linked Review: ${review.id}`;
        } else {
            return res.status(400).json({ error: "No Verified Buyer photo review found on your profile." });
        }
    } else if (taskType === 'monthly_lottery') {
         adminNote = "Monthly Lottery Entry";
    }

    // D. SAVE TO DB
    await db.transaction(async (tx) => {
        // 1. Create Claim Record
        await tx.insert(rewardClaimsTable).values({
            userId, taskType, proof: proofData, status, rewardAmount, adminNote
        });

        // 2. Immediate Payout (Only if Auto-Approved)
        if (status === 'approved') {
            await tx.update(usersTable)
                .set({ walletBalance: (user.walletBalance || 0) + rewardAmount })
                .where(eq(usersTable.id, userId));
            
            await tx.insert(walletTransactionsTable).values({
                userId, amount: rewardAmount, type: "task_reward", description: `Reward: ${taskType}`
            });
        }
    });

    if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    
    res.json({ 
        success: true, 
        message: status === 'approved' ? `⚡ Verified! ₹${rewardAmount} added instantly.` : "Proof uploaded! Under review." 
    });

  } catch (error) {
    console.error("Claim Error:", error);
    if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    res.status(500).json({ error: "Server Error" });
  }
});

// ==========================================
// ⚡ 4. ADMIN ROUTES
// ==========================================

/* ======================================================
   🔒 GET PENDING CLAIMS (Admin Only)
====================================================== */
router.get("/admin/pending", requireAuth, verifyAdmin, async (req, res) => {
  try {
    const pendingClaims = await db.query.rewardClaimsTable.findMany({
      where: eq(rewardClaimsTable.status, 'pending'),
      with: {
        user: { columns: { name: true, email: true } }
      },
      orderBy: [desc(rewardClaimsTable.createdAt)]
    });
    res.json(pendingClaims);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch claims" });
  }
});

/* ======================================================
   🔒 PICK LOTTERY WINNER (Admin Only)
====================================================== */
router.post("/admin/pick-lottery-winner", requireAuth, verifyAdmin, async (req, res) => {
  try {
    const entries = await db.query.rewardClaimsTable.findMany({
      where: and(
        eq(rewardClaimsTable.taskType, 'monthly_lottery'),
        eq(rewardClaimsTable.status, 'pending')
      ),
      with: { user: { columns: { name: true, email: true } } }
    });

    if (entries.length === 0) return res.status(400).json({ error: "No pending entries found." });

    const winner = entries[Math.floor(Math.random() * entries.length)];

    res.json({
      message: "Winner Selected",
      claimId: winner.id,
      user: winner.user,
      proof: winner.proof,
      instructions: "Verify user follows on Instagram before approving."
    });

  } catch (error) { res.status(500).json({ error: "Failed to pick winner" }); }
});

/* ======================================================
   🔒 ADMIN DECISION (Admin Only)
====================================================== */
router.post("/admin/decide", requireAuth, verifyAdmin, async (req, res) => {
    try {
        const { claimId, decision } = req.body;
        if(!['approve', 'reject'].includes(decision)) return res.status(400).json({error: "Invalid decision"});

        await db.transaction(async (tx) => {
            const claim = await tx.query.rewardClaimsTable.findFirst({ where: eq(rewardClaimsTable.id, claimId) });
            if (!claim || claim.status !== 'pending') throw new Error("Invalid or processed claim");

            await tx.update(rewardClaimsTable)
                .set({ status: decision === 'approve' ? 'approved' : 'rejected' })
                .where(eq(rewardClaimsTable.id, claimId));

            if (decision === 'approve') {
                const user = await tx.query.usersTable.findFirst({ where: eq(usersTable.id, claim.userId) });
                
                await tx.update(usersTable)
                    .set({ walletBalance: (user.walletBalance || 0) + claim.rewardAmount })
                    .where(eq(usersTable.id, claim.userId));

                await tx.insert(walletTransactionsTable).values({
                    userId: claim.userId, amount: claim.rewardAmount, type: "task_reward", description: `Reward: ${claim.taskType}`
                });
            }
        });
        res.json({ success: true, message: "Decision recorded" });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;