import { db } from "../../db/client.js";
import { usersTable, walletTransactionsTable, rewardClaimsTable, reviewsTable, rewardConfigTable, lotteryLogsTable } from "../../db/schema/index.js";
import { eq, and, desc, sql } from "drizzle-orm";

export const getRewardConfig = async () => {
  const config = await db.select().from(rewardConfigTable).limit(1);
  return config.length > 0 ? config[0] : null;
};

export const createRewardConfig = async (config) => {
  await db.insert(rewardConfigTable).values(config);
};

export const updateRewardConfig = async (id, config) => {
  await db.update(rewardConfigTable)
    .set({ ...config, updatedAt: new Date() })
    .where(eq(rewardConfigTable.id, id));
};

export const getUserClaimsHistory = async (userId) => {
  return await db.query.rewardClaimsTable.findMany({
    where: eq(rewardClaimsTable.userId, userId),
    orderBy: [desc(rewardClaimsTable.createdAt)]
  });
};

export const getExistingNonLotteryClaim = async (userId, taskType) => {
  return await db.query.rewardClaimsTable.findFirst({
    where: and(
        eq(rewardClaimsTable.userId, userId),
        eq(rewardClaimsTable.taskType, taskType),
        sql`${rewardClaimsTable.status} != 'rejected'` 
    )
  });
};

export const getRecentLotteryClaim = async (userId) => {
  return await db.query.rewardClaimsTable.findFirst({
    where: and(
        eq(rewardClaimsTable.userId, userId),
        eq(rewardClaimsTable.taskType, 'monthly_lottery'),
        sql`${rewardClaimsTable.createdAt} > NOW() - INTERVAL '30 days'`
    )
  });
};

export const getVerifiedBuyerReview = async (userId) => {
  return await db.query.reviewsTable.findFirst({
    where: and(
        eq(reviewsTable.userId, userId), 
        sql`array_length(${reviewsTable.photoUrls}, 1) > 0`,
        eq(reviewsTable.isVerifiedBuyer, true)
    ),
    orderBy: [desc(reviewsTable.createdAt)]
  });
};

export const getPendingClaims = async () => {
  return await db.query.rewardClaimsTable.findMany({
    where: eq(rewardClaimsTable.status, 'pending'),
    with: {
      user: { columns: { name: true, email: true } }
    },
    orderBy: [desc(rewardClaimsTable.createdAt)]
  });
};

export const pickRandomLotteryWinner = async () => {
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
    .innerJoin(usersTable, eq(rewardClaimsTable.userId, usersTable.id))
    .where(and(
      eq(rewardClaimsTable.taskType, 'monthly_lottery'),
      eq(rewardClaimsTable.status, 'pending')
    ))
    .orderBy(sql`RANDOM()`)
    .limit(1);
    
  return winnerEntry;
};

export const processRewardTransaction = async (callback) => {
  return await db.transaction(callback);
};

export const getClaimById = async (tx, claimId) => {
  return await tx.query.rewardClaimsTable.findFirst({ where: eq(rewardClaimsTable.id, claimId) });
};

export const updateClaimStatus = async (tx, claimId, status) => {
  await tx.update(rewardClaimsTable)
      .set({ status })
      .where(eq(rewardClaimsTable.id, claimId));
};

export const getUserById = async (tx, userId) => {
  return await tx.query.usersTable.findFirst({ where: eq(usersTable.id, userId) });
};

export const updateUserWallet = async (tx, userId, newBalance) => {
  await tx.update(usersTable)
      .set({ walletBalance: newBalance })
      .where(eq(usersTable.id, userId));
};

export const insertWalletTransaction = async (tx, userId, amount, type, description) => {
  await tx.insert(walletTransactionsTable).values({
      userId, amount, type, description
  });
};

export const insertRewardClaim = async (tx, data) => {
  await tx.insert(rewardClaimsTable).values(data);
};

export const insertLotteryLog = async (tx, data) => {
  await tx.insert(lotteryLogsTable).values(data);
};

export const getLotteryHistory = async () => {
    return await db.select({
        id: lotteryLogsTable.id,
        rewardAmount: lotteryLogsTable.rewardAmount,
        drawnAt: lotteryLogsTable.drawnAt,
        winner: {
            id: usersTable.id,
            name: usersTable.name,
            email: usersTable.email,
            profileImage: usersTable.profileImage
        },
        actorId: lotteryLogsTable.actorId
    })
    .from(lotteryLogsTable)
    .leftJoin(usersTable, eq(lotteryLogsTable.winnerId, usersTable.id))
    .orderBy(desc(lotteryLogsTable.drawnAt));
};
