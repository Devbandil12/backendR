import * as RewardsRepository from './rewards.repository.js';
import { createWorker } from "tesseract.js";

export const getRewardValues = async () => {
  try {
    const config = await RewardsRepository.getRewardConfig();
    if (config) {
      return {
        paparazzi: config.paparazzi ?? 20,
        loyal_follower: config.loyal_follower ?? 20,
        reviewer: config.reviewer ?? 10,
        monthly_lottery: config.monthly_lottery ?? 100
      };
    }
    return { paparazzi: 20, loyal_follower: 20, reviewer: 10, monthly_lottery: 100 }; 
  } catch (err) {
    console.error("Reward Config Read Error:", err);
    return { paparazzi: 20, loyal_follower: 20, reviewer: 10, monthly_lottery: 100 };
  }
};

export const updateRewardConfig = async (config) => {
  const existing = await RewardsRepository.getRewardConfig();
  
  const formattedConfig = {
      paparazzi: parseInt(config.paparazzi),
      loyal_follower: parseInt(config.loyal_follower),
      reviewer: parseInt(config.reviewer),
      monthly_lottery: parseInt(config.monthly_lottery)
  };

  if (!existing) {
      await RewardsRepository.createRewardConfig(formattedConfig);
  } else {
      await RewardsRepository.updateRewardConfig(existing.id, formattedConfig);
  }
};

export const getUserHistory = async (userId) => {
  return await RewardsRepository.getUserClaimsHistory(userId);
};

export const processClaim = async (user, taskType, handle, tempFilePath, originalFileName) => {
  const REWARDS = await getRewardValues(); 
  const userId = user.id;

  if (taskType !== 'monthly_lottery') {
      const existing = await RewardsRepository.getExistingNonLotteryClaim(userId, taskType);
      if (existing) {
          throw new Error("You have already completed or submitted this task!");
      }
  } else {
      const recentEntry = await RewardsRepository.getRecentLotteryClaim(userId);
      if (recentEntry) {
          throw new Error("You are already entered for this month!");
      }
  }

  let status = "pending";
  let rewardAmount = REWARDS[taskType] || 0;
  let adminNote = "Manual Review Required";
  let proofData = tempFilePath ? originalFileName : (handle || "Manual Check");

  if (tempFilePath && (taskType === 'paparazzi' || taskType === 'loyal_follower')) {
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

  if (taskType === 'reviewer') {
      const review = await RewardsRepository.getVerifiedBuyerReview(userId);

      if (review) {
          status = "approved"; 
          adminNote = `System Verified: Review ID ${review.id} (Verified Buyer)`;
          proofData = `Linked Review: ${review.id}`;
      } else {
          throw new Error("No Verified Buyer photo review found on your profile.");
      }
  } else if (taskType === 'monthly_lottery') {
       adminNote = "Monthly Lottery Entry";
  }

  await RewardsRepository.processRewardTransaction(async (tx) => {
      await RewardsRepository.insertRewardClaim(tx, {
          userId, taskType, proof: proofData, status, rewardAmount, adminNote
      });

      if (status === 'approved') {
          await RewardsRepository.updateUserWallet(tx, userId, (user.walletBalance || 0) + rewardAmount);
          await RewardsRepository.insertWalletTransaction(tx, userId, rewardAmount, "task_reward", `Reward: ${taskType}`);
      }
  });

  return { status, rewardAmount };
};

export const getPendingClaims = async () => {
  return await RewardsRepository.getPendingClaims();
};

export const pickLotteryWinner = async () => {
  const winnerEntry = await RewardsRepository.pickRandomLotteryWinner();
  
  if (!winnerEntry) {
      throw new Error("No pending entries found.");
  }

  return {
    claimId: winnerEntry.id,
    user: winnerEntry.user,
    proof: winnerEntry.proof,
    instructions: "Verify user follows on Instagram before approving."
  };
};

export const decideClaim = async (claimId, decision, actorId = null) => {
  if(!['approve', 'reject'].includes(decision)) throw new Error("Invalid decision");

  await RewardsRepository.processRewardTransaction(async (tx) => {
      const claim = await RewardsRepository.getClaimById(tx, claimId);
      if (!claim || claim.status !== 'pending') throw new Error("Invalid or processed claim");

      await RewardsRepository.updateClaimStatus(tx, claimId, decision === 'approve' ? 'approved' : 'rejected');

      if (decision === 'approve') {
          const user = await RewardsRepository.getUserById(tx, claim.userId);
          
          await RewardsRepository.updateUserWallet(tx, claim.userId, (user.walletBalance || 0) + claim.rewardAmount);
          await RewardsRepository.insertWalletTransaction(tx, claim.userId, claim.rewardAmount, "task_reward", `Reward: ${claim.taskType}`);
          
          if (claim.taskType === 'monthly_lottery') {
              await RewardsRepository.insertLotteryLog(tx, {
                  winnerId: claim.userId,
                  actorId: actorId,
                  rewardAmount: claim.rewardAmount
              });
          }
      }
  });
};

export const getLotteryHistory = async () => {
  return await RewardsRepository.getLotteryHistory();
};
