// ✅ file: routes/rewards.js
import express from "express";
import multer from "multer";
import { createWorker } from "tesseract.js";
import fs from 'fs'; // Kept for file cleanup only
// import path from 'path'; // REMOVED (No longer needed for config)
import { db } from "../configs/index.js";
// 🟢 Added rewardConfigTable
import { usersTable, walletTransactionsTable, rewardClaimsTable, reviewsTable, rewardConfigTable, referralsTable, ordersTable } from "../configs/schema.js"; // 🟢 UPDATED: referralsTable, ordersTable
import { eq, and, desc, sql } from "drizzle-orm";

// 🔒 SECURITY: Import Middleware
import { requireAuth, verifyAdmin } from "../middleware/authMiddleware.js";
import path from "path";
import { fileURLToPath } from "url";
// 🟢 NEW: referralConfig.json already existed with the intended amounts
// (₹50 each way) but was never actually imported anywhere in the codebase —
// read via fs instead of a JSON import assertion so this doesn't depend on
// a specific Node version in production.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const referralAmounts = JSON.parse(fs.readFileSync(path.join(__dirname, "../referralConfig.json"), "utf-8"));

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
            // 🟢 FIX (wallet integrity item #2): this used to be
            // `(user.walletBalance || 0) + rewardAmount` — a JS-computed value
            // based on `user` fetched well before this transaction opened.
            // That's a read-then-write, not an atomic increment: if anything
            // else touched this user's walletBalance in the gap (a checkout
            // wallet spend, another reward claim), this UPDATE overwrites it
            // and that other change is silently lost — the wallet_transactions
            // ledger then permanently disagrees with the cached balance.
            // `sql`${col} + amount`` increments atomically at the DB level
            // regardless of what `user.walletBalance` was when we read it.
            await tx.update(usersTable)
                .set({ walletBalance: sql`${usersTable.walletBalance} + ${rewardAmount}` })
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

/* ======================================================
   🔒 GET REFERRAL STATS (Owner Only)
   🟢 NEW: this endpoint never existed — WalletTab.jsx and
   OverviewTab.jsx have been calling GET /api/referrals/stats/:userId
   since they were built, silently 404ing. That's the actual root
   cause of "Aura Circle isn't showing a referral code": there was
   no code to show, because nothing ever generated one.
   Lazily generates + persists a referralCode on first call, since
   nothing does this at signup either.
====================================================== */
function generateReferralCode(name) {
  const initials = (name || "AURA").replace(/[^a-zA-Z]/g, "").slice(0, 4).toUpperCase().padEnd(4, "X");
  const digits = Math.floor(1000 + Math.random() * 9000);
  return `${initials}${digits}`;
}

router.get("/stats/:userId", requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const requester = await db.query.usersTable.findFirst({
      where: eq(usersTable.clerkId, req.auth.userId),
    });
    if (!requester) return res.status(401).json({ error: "Unauthorized" });
    if (userId !== requester.id && requester.role !== 'admin') {
      return res.status(403).json({ error: "Forbidden" }); // 🔒 same ownership check as /my-history above
    }

    let user = requester.id === userId ? requester : await db.query.usersTable.findFirst({ where: eq(usersTable.id, userId) });
    if (!user) return res.status(404).json({ error: "User not found" });

    // Lazily generate a code if this user doesn't have one yet, retrying
    // on the rare collision (referralCode has a unique constraint).
    if (!user.referralCode) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const candidate = generateReferralCode(user.name);
        try {
          const [updated] = await db.update(usersTable).set({ referralCode: candidate })
            .where(eq(usersTable.id, user.id)).returning();
          user = updated;
          break;
        } catch (err) {
          if (attempt === 4) throw err; // exhausted retries on unique-constraint collisions
        }
      }
    }

    const [{ totalEarnings }] = await db.select({ totalEarnings: sql`coalesce(sum(${walletTransactionsTable.amount}), 0)`.mapWith(Number) })
      .from(walletTransactionsTable)
      .where(and(eq(walletTransactionsTable.userId, user.id), eq(walletTransactionsTable.type, 'referral_bonus')));

    const referralRows = await db.select({ status: referralsTable.status })
      .from(referralsTable).where(eq(referralsTable.referrerId, user.id));
    const totalReferrals = referralRows.length;
    const completedReferrals = referralRows.filter(r => r.status === 'completed').length;

    res.json({
      referralCode: user.referralCode,
      walletBalance: user.walletBalance || 0,
      stats: { totalEarnings, totalReferrals, completedReferrals },
    });
  } catch (error) {
    console.error("❌ Referral Stats Error:", error);
    res.status(500).json({ error: "Failed to fetch referral stats" });
  }
});

/* ======================================================
   🔒 APPLY A REFERRAL CODE (User Only)
   🟢 NEW: also never existed — the "Redeem" form in WalletTab.jsx
   has been POSTing here with no route to receive it.
====================================================== */
router.post("/apply", requireAuth, async (req, res) => {
  try {
    const { code } = req.body; // userId is trusted from the auth token below, never from the body
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: "Please enter a referral code." });
    }

    const requester = await db.query.usersTable.findFirst({
      where: eq(usersTable.clerkId, req.auth.userId),
    });
    if (!requester) return res.status(401).json({ error: "Unauthorized" });

    if (requester.referredBy) {
      return res.status(400).json({ error: "You've already used a referral code." });
    }

    const referrer = await db.query.usersTable.findFirst({
      where: eq(usersTable.referralCode, code.trim().toUpperCase()),
    });
    if (!referrer) return res.status(404).json({ error: "That referral code doesn't exist." });
    if (referrer.id === requester.id) return res.status(400).json({ error: "You can't refer yourself." });

    // One order already placed disqualifies "new customer" referral bonuses —
    // matches processReferralCompletion firing on a first order only.
    const [existingOrder] = await db.select({ id: ordersTable.id }).from(ordersTable)
      .where(and(eq(ordersTable.userId, requester.id), sql`${ordersTable.status} != 'Order Cancelled'`)).limit(1);
    if (existingOrder) {
      return res.status(400).json({ error: "Referral codes can only be applied by new customers, before your first order." });
    }

    await db.transaction(async (tx) => {
      await tx.update(usersTable).set({ referredBy: referrer.id }).where(eq(usersTable.id, requester.id));
      await tx.insert(referralsTable).values({
        referrerId: referrer.id, refereeId: requester.id, status: 'pending',
        rewardAmount: referralAmounts.REFERRER_BONUS, // 🟢 UPDATED: from config, not the table's generic default
      });

      // 🟢 NEW: the friend applying the code gets an instant bonus too —
      // previously only the referrer was ever rewarded (and only much
      // later, on the friend's first order). A one-sided "I get rewarded
      // if you use my code" isn't much of a pitch for the friend; this
      // makes the share message's "you both get a reward" honest.
      await tx.update(usersTable)
        .set({ walletBalance: sql`${usersTable.walletBalance} + ${referralAmounts.REFEREE_BONUS}` })
        .where(eq(usersTable.id, requester.id));
      await tx.insert(walletTransactionsTable).values({
        userId: requester.id, amount: referralAmounts.REFEREE_BONUS,
        type: 'referral_signup_bonus', description: `Welcome bonus for using ${referrer.name || 'a friend'}'s referral code`,
      });
    });

    res.json({
      success: true,
      message: `Code applied! ₹${referralAmounts.REFEREE_BONUS} added to your wallet. Your friend gets theirs once you complete your first order.`,
    });
  } catch (error) {
    console.error("❌ Referral Apply Error:", error);
    res.status(500).json({ error: "Failed to apply referral code." });
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
   🔒 PICK LOTTERY WINNER (Admin Only) - SCALABLE
====================================================== */
router.post("/admin/pick-lottery-winner", requireAuth, verifyAdmin, async (req, res) => {
  try {
    // ⚡ SCALABLE FIX: Use SQL 'ORDER BY RANDOM()' instead of loading all rows
    const [winnerEntry] = await db
      .select({
        id: rewardClaimsTable.id,
        proof: rewardClaimsTable.proof,
        user: {
          name: usersTable.name,
          email: usersTable.email
        }
      })
      .from(rewardClaimsTable)
      // Join to get user details efficiently
      .innerJoin(usersTable, eq(rewardClaimsTable.userId, usersTable.id))
      .where(and(
        eq(rewardClaimsTable.taskType, 'monthly_lottery'),
        eq(rewardClaimsTable.status, 'pending')
      ))
      .orderBy(sql`RANDOM()`) // 🟢 This happens in DB, not RAM
      .limit(1);

    if (!winnerEntry) {
        return res.status(400).json({ error: "No pending entries found." });
    }

    res.json({
      message: "Winner Selected",
      claimId: winnerEntry.id,
      user: winnerEntry.user,
      proof: winnerEntry.proof,
      instructions: "Verify user follows on Instagram before approving."
    });

  } catch (error) { 
      console.error("Pick Winner Error:", error);
      res.status(500).json({ error: "Failed to pick winner" }); 
  }
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
                // 🟢 FIX (wallet integrity item #2): same lost-update issue as
                // the instant-approval path above — atomic increment instead
                // of a JS-computed read-then-write.
                await tx.update(usersTable)
                    .set({ walletBalance: sql`${usersTable.walletBalance} + ${claim.rewardAmount}` })
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