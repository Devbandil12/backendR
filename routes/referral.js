// file: routes/referral.js
import express from "express";
import { db } from "../configs/index.js";
import { usersTable, referralsTable, walletTransactionsTable } from "../configs/schema.js"; 
import { eq, desc } from "drizzle-orm";
import { getAllReferrals } from "../controllers/referralController.js";

const router = express.Router();

// ✅ FIXED: Native generator (No nanoid required)
const generateReferralCode = (name) => {
  // Take first 4 letters of name (or "USER"), uppercase them, add 4 random digits
  const cleanName = (name || "USER").replace(/[^a-zA-Z]/g, '').toUpperCase().substring(0, 4);
  const random = Math.floor(1000 + Math.random() * 9000); // e.g. 4521
  return `${cleanName}${random}`;
};

// 🟢 GET: User's Referral Stats & Wallet History
router.get("/stats/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId || userId === 'undefined') return res.status(400).json({ error: "Invalid User ID" });

    // 1. Get User Data with Referrals
    const user = await db.query.usersTable.findFirst({
      where: eq(usersTable.id, userId),
      with: {
        walletTransactions: {
          orderBy: [desc(walletTransactionsTable.createdAt)],
          limit: 20,
        },
        referralsMade: {
          with: { referee: true } // Fetch details of people referred
        }
      }
    });

    if (!user) return res.status(404).json({ error: "User not found" });

    // 2. Generate Code if missing
    if (!user.referralCode) {
      const newCode = generateReferralCode(user.name);
      await db.update(usersTable).set({ referralCode: newCode }).where(eq(usersTable.id, userId));
      user.referralCode = newCode;
    }

    // 3. Calculate Stats
    const totalEarnings = (user.walletTransactions || [])
      .filter(t => t.amount > 0 && t.type === 'referral_bonus')
      .reduce((acc, curr) => acc + curr.amount, 0);

    const pendingReferralsList = (user.referralsMade || []).filter(r => r.status === 'pending');
    const successfulReferralsCount = (user.referralsMade || []).filter(r => r.status === 'completed').length;

    // 4. Merge Transactions with Pending Referrals for "Unified History"
    // We create fake transaction objects for pending referrals to show them in the list
    const pendingHistoryItems = pendingReferralsList.map(ref => ({
      id: `pending-${ref.id}`,
      amount: 0, // No money yet
      type: 'pending_referral',
      description: `Referral Pending: ${ref.referee?.name || 'Friend'}`,
      createdAt: ref.createdAt,
      isPending: true
    }));

    // Combine real transactions and pending items, sort by date
    const unifiedHistory = [...user.walletTransactions, ...pendingHistoryItems].sort((a, b) => 
      new Date(b.createdAt) - new Date(a.createdAt)
    );

    res.json({
      referralCode: user.referralCode,
      walletBalance: user.walletBalance || 0,
      history: unifiedHistory, // 🟢 Now contains pending items
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

// 🟢 POST: Apply Referral Code (Used by the Friend)
router.post("/apply", async (req, res) => {
  try {
    const { userId, code } = req.body;

    // 1. Validate inputs
    if (!userId || !code) return res.status(400).json({ error: "Missing data" });

    // 2. Fetch Users
    const currentUser = await db.query.usersTable.findFirst({ where: eq(usersTable.id, userId) });
    if (!currentUser) return res.status(404).json({ error: "User not found" });
    if (currentUser.referredBy) return res.status(400).json({ error: "You have already been referred." });

    const referrer = await db.query.usersTable.findFirst({ where: eq(usersTable.referralCode, code) });
    if (!referrer) return res.status(404).json({ error: "Invalid referral code." });
    if (referrer.id === userId) return res.status(400).json({ error: "You cannot refer yourself." });

    // 3. Perform Updates (Transaction safely)
    await db.transaction(async (tx) => {
      // A. Link the users
      await tx.update(usersTable).set({ referredBy: referrer.id }).where(eq(usersTable.id, userId));

      // B. Reward the Friend (User B) immediately - ₹100 Welcome Bonus
      await tx.update(usersTable)
        .set({ walletBalance: (currentUser.walletBalance || 0) + 100 })
        .where(eq(usersTable.id, userId));

      await tx.insert(walletTransactionsTable).values({
        userId: userId,
        amount: 100,
        type: 'referral_bonus',
        description: `Welcome Bonus (Referred by ${referrer.name})`
      });

      // C. Create Pending Record for Referrer (User A) - They get paid later
      await tx.insert(referralsTable).values({
        referrerId: referrer.id,
        refereeId: userId,
        status: 'pending', // Becomes 'completed' when User B places an order
        rewardAmount: 150, // User A gets ₹150 later
      });
    });

    res.json({ success: true, message: "Code applied! ₹100 added to your wallet." });

  } catch (error) {
    console.error("Apply Referral Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/admin/all", getAllReferrals);

export default router;