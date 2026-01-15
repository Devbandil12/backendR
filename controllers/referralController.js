// file: controllers/referralController.js
import { db } from '../configs/index.js';
import { usersTable, referralsTable, walletTransactionsTable, ordersTable } from '../configs/schema.js';
import { eq, desc, and, sql } from 'drizzle-orm';
import { createNotification } from '../helpers/notificationManager.js';

// 🟢 HELPER: Complete a referral when a user places their first order
export const processReferralCompletion = async (userId, txOrDb = db) => {
  try {
    // 1. Check if this user was referred and status is still 'pending'
    const [referral] = await txOrDb
      .select()
      .from(referralsTable)
      .where(and(
        eq(referralsTable.refereeId, userId),
        eq(referralsTable.status, 'pending')
      ));

    if (!referral) return; // No pending referral found

    console.log(`🎁 Completing Referral: ${referral.referrerId} referred ${userId}`);

    // 2. Mark as Completed
    await txOrDb.update(referralsTable)
      .set({ status: 'completed' })
      .where(eq(referralsTable.id, referral.id));

    // 3. Reward the Referrer (User A)
    const reward = referral.rewardAmount || 150;

    await txOrDb.update(usersTable)
      .set({ walletBalance: sql`${usersTable.walletBalance} + ${reward}` })
      .where(eq(usersTable.id, referral.referrerId));

    // 4. Log Transaction
    await txOrDb.insert(walletTransactionsTable).values({
      userId: referral.referrerId,
      amount: reward,
      type: 'referral_bonus',
      description: 'Referral Reward (Friend placed first order)',
    });

    // 5. Notify Referrer
    await createNotification(
      referral.referrerId,
      `You earned ₹${reward}! Your friend completed their first order.`,
      '/wallet',
      'wallet'
    );

  } catch (error) {
    console.error("❌ Referral Completion Error:", error);
    // Don't block the main order flow if this fails
  }
};

// 🟢 ADMIN: Get All Referrals
export const getAllReferrals = async (req, res) => {
  try {
    const allReferrals = await db.query.referralsTable.findMany({
      orderBy: [desc(referralsTable.createdAt)],
      with: {
        referrer: { columns: { name: true, email: true, referralCode: true } },
        referee: { columns: { name: true, email: true } }
      }
    });

    // Calculate Stats
    const stats = {
      total: allReferrals.length,
      pending: allReferrals.filter(r => r.status === 'pending').length,
      completed: allReferrals.filter(r => r.status === 'completed').length,
      totalPayout: allReferrals
        .filter(r => r.status === 'completed')
        .reduce((acc, r) => acc + (r.rewardAmount || 0), 0)
    };

    res.json({ referrals: allReferrals, stats });
  } catch (error) {
    console.error("Admin Referral Fetch Error:", error);
    res.status(500).json({ error: "Failed to fetch referrals" });
  }
};