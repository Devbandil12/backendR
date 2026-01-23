// ✅ file: routes/referral.js
import express from "express";
import fs from "fs";
import path from "path";
import { db } from "../configs/index.js";
import { usersTable, referralsTable, walletTransactionsTable } from "../configs/schema.js"; 
import { eq, desc, sql, and } from "drizzle-orm";

// 🔒 SECURITY: Import Middleware
import { requireAuth, verifyAdmin } from "../middleware/authMiddleware.js";

const router = express.Router();

// ==========================================
// 🟢 1. DYNAMIC SETTINGS ENGINE
// ==========================================
const CONFIG_FILE = path.resolve("referralConfig.json");

// Default Config
const DEFAULT_CONFIG = {
  REFEREE_BONUS: 100, // Friend (Welcome)
  REFERRER_BONUS: 150 // You (Reward)
};

// Helper: Read Config
const getRewards = () => {
  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG));
      return DEFAULT_CONFIG;
    }
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (err) {
    console.error("Config Read Error:", err);
    return DEFAULT_CONFIG;
  }
};

// Helper: Write Config
const saveRewards = (newConfig) => {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(newConfig, null, 2));
    return true;
  } catch (err) {
    console.error("Config Write Error:", err);
    return false;
  }
};

// Native Generator
const generateReferralCode = (name) => {
  const cleanName = (name || "USER").replace(/[^a-zA-Z]/g, '').toUpperCase().substring(0, 4);
  const random = Math.floor(1000 + Math.random() * 9000); 
  return `${cleanName}${random}`;
};

/* ======================================================
   🟢 GET CONFIG (Public/User)
====================================================== */
router.get("/config", (req, res) => {
  res.json(getRewards());
});

/* ======================================================
   🔒 UPDATE CONFIG (Admin Only)
====================================================== */
router.post("/config", requireAuth, verifyAdmin, (req, res) => {
  const { refereeBonus, referrerBonus } = req.body;
  if (refereeBonus === undefined || referrerBonus === undefined) {
    return res.status(400).json({ error: "Invalid values" });
  }
  
  const newConfig = {
    REFEREE_BONUS: parseInt(refereeBonus),
    REFERRER_BONUS: parseInt(referrerBonus)
  };

  saveRewards(newConfig);
  res.json({ success: true, config: newConfig });
});


/* ======================================================
   🔒 GET STATS (User & Admin)
   - Checks ownership
====================================================== */
router.get("/stats/:userId", requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const requesterClerkId = req.auth.userId;

    if (!userId || userId === 'undefined') return res.status(400).json({ error: "Invalid User ID" });

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

    const user = await db.query.usersTable.findFirst({
      where: eq(usersTable.id, userId),
      with: {
        walletTransactions: {
          orderBy: [desc(walletTransactionsTable.createdAt)],
          limit: 20,
        },
        referralsMade: {
          with: { referee: true } 
        }
      }
    });

    if (!user) return res.status(404).json({ error: "User not found" });

    // Generate Code if missing
    if (!user.referralCode) {
      const newCode = generateReferralCode(user.name);
      await db.update(usersTable).set({ referralCode: newCode }).where(eq(usersTable.id, userId));
      user.referralCode = newCode;
    }

    const totalEarnings = (user.walletTransactions || [])
      .filter(t => t.amount > 0 && t.type === 'referral_bonus')
      .reduce((acc, curr) => acc + curr.amount, 0);

    const pendingReferralsList = (user.referralsMade || []).filter(r => r.status === 'pending');
    const successfulReferralsCount = (user.referralsMade || []).filter(r => r.status === 'completed').length;

    const pendingHistoryItems = pendingReferralsList.map(ref => ({
      id: `pending-${ref.id}`,
      amount: 0, 
      type: 'pending_referral',
      description: `Referral Pending: ${ref.referee?.name || 'Friend'}`,
      createdAt: ref.createdAt,
      isPending: true
    }));

    const unifiedHistory = [...user.walletTransactions, ...pendingHistoryItems].sort((a, b) => 
      new Date(b.createdAt) - new Date(a.createdAt)
    );

    res.json({
      referralCode: user.referralCode,
      walletBalance: user.walletBalance || 0,
      history: unifiedHistory, 
      stats: {
        totalEarnings,
        successfulReferrals: successfulReferralsCount,
        pendingReferrals: pendingReferralsList.length
      }
    });

  } catch (error) {
    console.error("Referral Stats Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

/* ======================================================
   🔒 APPLY REFERRAL (User Only)
   - Uses Token Identity
====================================================== */
router.post("/apply", requireAuth, async (req, res) => {
  try {
    const { code } = req.body;
    const requesterClerkId = req.auth.userId; // 🟢 Secure Identity
    const REWARDS = getRewards();

    if (!code) return res.status(400).json({ error: "Missing referral code" });

    // Resolve User
    const currentUser = await db.query.usersTable.findFirst({ 
        where: eq(usersTable.clerkId, requesterClerkId) 
    });
    if (!currentUser) return res.status(404).json({ error: "User not found" });
    
    const userId = currentUser.id; // Use DB ID

    if (currentUser.referredBy) return res.status(400).json({ error: "You have already been referred." });

    const referrer = await db.query.usersTable.findFirst({ where: eq(usersTable.referralCode, code) });
    if (!referrer) return res.status(404).json({ error: "Invalid referral code." });
    if (referrer.id === userId) return res.status(400).json({ error: "You cannot refer yourself." });

    await db.transaction(async (tx) => {
      // A. Link users
      await tx.update(usersTable).set({ referredBy: referrer.id }).where(eq(usersTable.id, userId));

      // B. Reward Friend (Referee)
      await tx.update(usersTable)
        .set({ walletBalance: (currentUser.walletBalance || 0) + REWARDS.REFEREE_BONUS })
        .where(eq(usersTable.id, userId));

      await tx.insert(walletTransactionsTable).values({
        userId: userId,
        amount: REWARDS.REFEREE_BONUS, 
        type: 'referral_bonus',
        description: `Welcome Bonus (Referred by ${referrer.name})`
      });

      // C. Create Pending Reward for Referrer
      await tx.insert(referralsTable).values({
        referrerId: referrer.id,
        refereeId: userId,
        status: 'pending',
        rewardAmount: REWARDS.REFERRER_BONUS,
      });
    });

    res.json({ success: true, message: `Code applied! ₹${REWARDS.REFEREE_BONUS} added to your wallet.` });

  } catch (error) {
    console.error("Apply Referral Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

/* ======================================================
   🔒 GET ALL REFERRALS (Admin Only)
====================================================== */
router.get("/admin/all", requireAuth, verifyAdmin, async (req, res) => {
  try {
    const referrals = await db.query.referralsTable.findMany({
      with: {
        referrer: { columns: { name: true, email: true, referralCode: true } },
        referee: { columns: { id: true, name: true, email: true } },
      },
      orderBy: [desc(referralsTable.createdAt)],
    });

    const enrichedReferrals = await Promise.all(referrals.map(async (ref) => {
        let refereeBonus = 0;
        
        if (ref.refereeId) {
            const bonusTx = await db.query.walletTransactionsTable.findFirst({
                where: and(
                    eq(walletTransactionsTable.userId, ref.refereeId),
                    eq(walletTransactionsTable.type, 'referral_bonus')
                )
            });
            if (bonusTx) refereeBonus = bonusTx.amount;
        }

        return {
            ...ref,
            refereeBonus 
        };
    }));

    const pending = referrals.filter(r => r.status === 'pending').length;
    const completed = referrals.filter(r => r.status === 'completed').length;

    const [payoutResult] = await db
      .select({ total: sql`SUM(${walletTransactionsTable.amount})` })
      .from(walletTransactionsTable)
      .where(eq(walletTransactionsTable.type, 'referral_bonus'));

    const totalPayout = payoutResult?.total || 0;

    res.json({
      referrals: enrichedReferrals,
      stats: {
        total: referrals.length,
        pending,
        completed,
        totalPayout 
      }
    });

  } catch (error) {
    console.error("Admin Referral Error:", error);
    res.status(500).json({ error: "Failed to fetch referrals" });
  }
});

export default router;