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
// Define where the config file lives
const CONFIG_FILE = path.resolve("rewardsConfig.json");

// Default values if file doesn't exist
const DEFAULT_REWARDS = {
  paparazzi: 100,
  loyal_follower: 50,
  reviewer: 50,
  monthly_lottery: 500 // 🟢 Monthly Default
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
// 🟢 2. GET PENDING CLAIMS (For Admin Tab)
// ==========================================
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

// ==========================================
// 🟢 3. MAIN CLAIM ROUTE
// ==========================================
router.post("/claim", upload.single("proofImage"), async (req, res) => {
  let tempFilePath = null;
  const REWARDS = getRewardValues(); // 🟢 Load Dynamic Prices

  try {
    const { userId, taskType, handle } = req.body;
    const file = req.file;
    tempFilePath = file ? file.path : null;

    if (!userId || !taskType) return res.status(400).json({ error: "Missing required fields" });

    // A. DUPLICATE CHECK (Generic)
    // We check if this exact task was already claimed (and not rejected)
    const existing = await db.query.rewardClaimsTable.findFirst({
      where: and(
        eq(rewardClaimsTable.userId, userId),
        eq(rewardClaimsTable.taskType, taskType),
        sql`${rewardClaimsTable.status} != 'rejected'`
      )
    });

    if (existing && taskType !== 'monthly_lottery') {
      return res.status(400).json({ error: "You have already claimed this reward!" });
    }
    
    // B. LOTTERY CHECK (30 Days Limit)
    if (taskType === 'monthly_lottery') {
       const recentEntry = await db.query.rewardClaimsTable.findFirst({
          where: and(
            eq(rewardClaimsTable.userId, userId),
            eq(rewardClaimsTable.taskType, 'monthly_lottery'),
            sql`${rewardClaimsTable.createdAt} > NOW() - INTERVAL '30 days'` // 🟢 30 Days check
          )
       });
       if (recentEntry) {
         return res.status(400).json({ error: "You are already entered for this month's draw!" });
       }
    }

    let status = "pending";
    let rewardAmount = 0;
    let adminNote = "";
    let proofData = file ? file.filename : (handle || "Manual Check");

    // --- ASSIGN REWARDS DYNAMICALLY ---
    if (taskType === "paparazzi") {
      rewardAmount = REWARDS.paparazzi;
      if (file) {
        const worker = await createWorker('eng');
        const { data: { text } } = await worker.recognize(tempFilePath);
        await worker.terminate();
        const clean = text.toLowerCase();
        if (clean.includes("seen by") || clean.includes("views") || clean.includes("viewers")) { 
            status = "approved"; adminNote = "AI Verified"; 
        } else { 
            adminNote = "AI Unsure"; 
        }
      }
    } 
    else if (taskType === "loyal_follower") {
      rewardAmount = REWARDS.loyal_follower;
      if (file) {
        const worker = await createWorker('eng');
        const { data: { text } } = await worker.recognize(tempFilePath);
        await worker.terminate();
        if (text.toLowerCase().includes("following")) { 
            status = "approved"; adminNote = "AI Verified"; 
        }
      }
    } 
    else if (taskType === "reviewer") {
      rewardAmount = REWARDS.reviewer;
      const review = await db.query.reviewsTable.findFirst({
        where: eq(reviewsTable.userId, userId),
        orderBy: [desc(reviewsTable.createdAt)]
      });
      if (review && review.photoUrls?.length > 0) {
        status = "approved"; adminNote = `System Verified: Review ${review.id}`; proofData = `Review ID: ${review.id}`;
      } else { return res.status(400).json({ error: "No photo review found!" }); }
    } 
    else if (taskType === "monthly_lottery") {
      rewardAmount = REWARDS.monthly_lottery; // 🟢 Use monthly amount
      status = "pending"; 
      adminNote = `Monthly Lottery Entry`;
    }

    // C. SAVE TO DB
    await db.transaction(async (tx) => {
      // 1. Save Claim
      await tx.insert(rewardClaimsTable).values({ 
        userId, taskType, proof: proofData, status, rewardAmount, adminNote 
      });
      
      // 2. Immediate Payout (Only if Auto-Approved)
      if (status === "approved") {
        const user = await tx.query.usersTable.findFirst({ where: eq(usersTable.id, userId) });
        await tx.update(usersTable)
          .set({ walletBalance: (user.walletBalance || 0) + rewardAmount })
          .where(eq(usersTable.id, userId));

        await tx.insert(walletTransactionsTable).values({
          userId, amount: rewardAmount, type: "task_reward", description: `Reward: ${taskType}`
        });
      }
    });

    if (file && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    res.json({ success: true, message: status === 'approved' ? `🎉 Verified! ₹${rewardAmount} added.` : "Submitted." });

  } catch (error) {
    console.error("Claim Error:", error);
    if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    res.status(500).json({ error: "Server Error" });
  }
});

// ==========================================
// 🟢 4. ADMIN: PICK MONTHLY WINNER
// ==========================================
router.post("/admin/pick-lottery-winner", async (req, res) => {
  try {
    const entries = await db.query.rewardClaimsTable.findMany({
      where: and(
        eq(rewardClaimsTable.taskType, 'monthly_lottery'), // 🟢 Look for Monthly
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
      instructions: "Verify user follows on Instagram."
    });

  } catch (error) { res.status(500).json({ error: "Failed to pick winner" }); }
});

// ==========================================
// 🟢 5. ADMIN: DECIDE (Approve/Reject)
// ==========================================
router.post("/admin/decide", async (req, res) => {
    try {
        const { claimId, decision } = req.body;
        if(!['approve', 'reject'].includes(decision)) return res.status(400).json({error: "Invalid"});

        await db.transaction(async (tx) => {
            const claim = await tx.query.rewardClaimsTable.findFirst({ where: eq(rewardClaimsTable.id, claimId) });
            if (!claim || claim.status !== 'pending') throw new Error("Invalid claim");

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
        res.json({ success: true, message: "Done" });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Helper for Pretty Names
const formatTaskName = (t) => {
  if (t === 'paparazzi') return 'Story Task';
  if (t === 'loyal_follower') return 'Follow Task';
  if (t === 'reviewer') return 'Review Bonus';
  if (t === 'monthly_lottery') return 'Monthly Lottery Win';
  return 'Task Reward';
};

export default router;