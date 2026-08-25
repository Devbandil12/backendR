import { db } from '../../db/client.js';
import { usersTable, referralsTable, walletTransactionsTable, ordersTable } from '../../db/schema/index.js';
import { eq, desc, and, sql, gt } from 'drizzle-orm';

export const getUserByClerkId = async (clerkId) => {
  return await db.query.usersTable.findFirst({
      where: eq(usersTable.clerkId, clerkId)
  });
};

export const getUserById = async (id) => {
  return await db.query.usersTable.findFirst({
      where: eq(usersTable.id, id)
  });
};

export const updateReferralCode = async (userId, code) => {
  const [updated] = await db.update(usersTable)
    .set({ referralCode: code })
    .where(eq(usersTable.id, userId))
    .returning();
  return updated;
};

export const getTotalEarnings = async (userId) => {
  const [{ totalEarnings }] = await db.select({ totalEarnings: sql`coalesce(sum(${walletTransactionsTable.amount}), 0)`.mapWith(Number) })
      .from(walletTransactionsTable)
      .where(and(eq(walletTransactionsTable.userId, userId), gt(walletTransactionsTable.amount, 0)));
  return totalEarnings;
};

export const getReferralsByReferrer = async (referrerId) => {
  return await db.select({ status: referralsTable.status })
      .from(referralsTable).where(eq(referralsTable.referrerId, referrerId));
};

export const getWalletHistory = async (userId) => {
  return await db.select({
      amount: walletTransactionsTable.amount,
      description: walletTransactionsTable.description,
      createdAt: walletTransactionsTable.createdAt
    })
    .from(walletTransactionsTable)
    .where(eq(walletTransactionsTable.userId, userId))
    .orderBy(desc(walletTransactionsTable.createdAt));
};

export const getUserByReferralCode = async (code) => {
  return await db.query.usersTable.findFirst({
    where: eq(usersTable.referralCode, code),
  });
};

export const checkExistingOrder = async (userId) => {
  const [existingOrder] = await db.select({ id: ordersTable.id }).from(ordersTable)
      .where(and(eq(ordersTable.userId, userId), sql`${ordersTable.status} != 'Order Cancelled'`)).limit(1);
  return !!existingOrder;
};

export const applyReferralTransaction = async (requesterId, referrerId, referralAmounts) => {
  await db.transaction(async (tx) => {
      await tx.update(usersTable).set({ referredBy: referrerId }).where(eq(usersTable.id, requesterId));
      
      await tx.insert(referralsTable).values({
        referrerId: referrerId, refereeId: requesterId, status: 'pending',
        rewardAmount: referralAmounts.REFERRER_BONUS, 
      });

      await tx.update(usersTable)
        .set({ walletBalance: sql`${usersTable.walletBalance} + ${referralAmounts.REFEREE_BONUS}` })
        .where(eq(usersTable.id, requesterId));
        
      await tx.insert(walletTransactionsTable).values({
        userId: requesterId, amount: referralAmounts.REFEREE_BONUS,
        type: 'referral_signup_bonus', description: `Welcome bonus for using a referral code`,
      });
  });
};

export const getPendingReferral = async (userId, txOrDb) => {
  const [referral] = await txOrDb
      .select()
      .from(referralsTable)
      .where(and(
        eq(referralsTable.refereeId, userId),
        eq(referralsTable.status, 'pending')
      ));
  return referral;
};

export const completeReferralTransaction = async (referral, reward, txOrDb) => {
  await txOrDb.update(referralsTable)
      .set({ status: 'completed' })
      .where(eq(referralsTable.id, referral.id));

  await txOrDb.update(usersTable)
      .set({ walletBalance: sql`${usersTable.walletBalance} + ${reward}` })
      .where(eq(usersTable.id, referral.referrerId));

  await txOrDb.insert(walletTransactionsTable).values({
      userId: referral.referrerId,
      amount: reward,
      type: 'referral_bonus',
      description: 'Referral Reward (Friend placed first order)',
  });
};

export const getAllReferrals = async () => {
  return await db.query.referralsTable.findMany({
      orderBy: [desc(referralsTable.createdAt)],
      with: {
        referrer: { columns: { name: true, email: true, referralCode: true } },
        referee: { columns: { name: true, email: true } }
      }
  });
};
