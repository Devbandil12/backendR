// file: routes/rewards.js
import express from "express";
import multer from "multer";
import { createWorker } from "tesseract.js";
import fs from 'fs';
import path from 'path';
import { db } from "../configs/index.js";
import { usersTable, walletTransactionsTable, rewardClaimsTable, reviewsTable } from "../configs/schema.js";
import { eq, and, desc, sql } from "drizzle-orm";

const router = express.Router();
const upload = multer({ dest: "uploads/" }); // Temp folder for images

// ==========================================
// 🟢 1. DYNAMIC CONFIG SYSTEM
// ==========================================
const CONFIG_FILE = path.resolve("rewardsConfig.json");

// Default values
const DEFAULT_REWARDS = {
  paparazzi: 100,
  loyal_follower: 50,
  reviewer: 50,
  monthly_lottery: 500
};

// Helper: Read Config
const getRewardValues = () => {
  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_REWARDS));
      return DEFAULT_REWARDS;
    }
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (err) { return DEFAULT_REWARDS; }
};

// Helper: Save Config
const saveRewardValues = (newValues) => {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(newValues, null, 2));
    return true;
  } catch (err) { return false; }
};

// API: Get Current Config
router.get("/config", (req, res) => {
  res.json(getRewardValues());
});

// API: Update Config
router.post("/config", (req, res) => {
  const { paparazzi, loyal_follower, reviewer, monthly_lottery } = req.body;
  if (!paparazzi || !loyal_follower || !reviewer || !monthly_lottery) {
    return res.status(400).json({ error: "Missing values" });
  }

  const newConfig = {
    paparazzi: parseInt(paparazzi),
    loyal_follower: parseInt(loyal_follower),
    reviewer: parseInt(reviewer),
    monthly_lottery: parseInt(monthly_lottery)
  };

  saveRewardValues(newConfig);
  res.json({ success: true, config: newConfig });
});

// ==========================================
// 🟢 2. NEW: GET USER HISTORY (Crucial for UI)
// ==========================================
router.get("/my-history/:userId", async (req, res) => {
    try {
        const { userId } = req.params;
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

// ==========================================
// 🟢 3. MAIN CLAIM ROUTE (Advanced Logic)
// ==========================================
router.post("/claim", upload.single("proofImage"), async (req, res) => {
  let tempFilePath = null;
  const REWARDS = getRewardValues(); 

  try {
    const { userId, taskType, handle } = req.body;
    const file = req.file;
    tempFilePath = file ? file.path : null;

    if (!userId || !taskType) return res.status(400).json({ error: "Missing required fields" });

    // A. DUPLICATE CHECK (Prevent Spam)
    // For one-time tasks (like Following), check if they already did it.
    if (taskType !== 'monthly_lottery') {
        const existing = await db.query.rewardClaimsTable.findFirst({
            where: and(
                eq(rewardClaimsTable.userId, userId),
                eq(rewardClaimsTable.taskType, taskType),
                sql`${rewardClaimsTable.status} != 'rejected'` // Allow retry only if rejected
            )
        });
        if (existing) {
            return res.status(400).json({ error: "You have already submitted this task!" });
        }
    } else {
        // Lottery: Strict Once per 30 Days Check
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
            
            // Simple keyword matching to help Admin
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
                sql`array_length(${reviewsTable.photoUrls}, 1) > 0`
            ),
            orderBy: [desc(reviewsTable.createdAt)]
        });

        if (review) {
            status = "approved"; 
            adminNote = `System Verified: Review ID ${review.id}`;
            proofData = `Linked Review: ${review.id}`;
        } else {
            return res.status(400).json({ error: "No photo review found on your profile yet." });
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
            const user = await tx.query.usersTable.findFirst({ where: eq(usersTable.id, userId) });
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
        message: status === 'approved' ? `🎉 Verified! ₹${rewardAmount} added instantly.` : "Proof uploaded! Under review." 
    });

  } catch (error) {
    console.error("Claim Error:", error);
    if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    res.status(500).json({ error: "Server Error" });
  }
});

// ==========================================
// 🟢 4. ADMIN ROUTES
// ==========================================

// Get Pending Claims
router.get("/admin/pending", async (req, res) => {
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

// Pick Lottery Winner
router.post("/admin/pick-lottery-winner", async (req, res) => {
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

// Admin Decision (Approve/Reject)
router.post("/admin/decide", async (req, res) => {
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