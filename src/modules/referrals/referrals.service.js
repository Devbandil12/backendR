import fs from 'fs';
import path from "path";
import { fileURLToPath } from "url";
import * as ReferralsRepository from './referrals.repository.js';
import { createNotification } from '../../modules/notifications/notifications.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.join(__dirname, "../../config/referralConfig.json");
let referralAmounts = JSON.parse(fs.readFileSync(configPath, "utf-8"));

export const getConfig = () => referralAmounts;
export const updateConfig = (newConfig) => {
    referralAmounts = { ...referralAmounts, ...newConfig };
    fs.writeFileSync(configPath, JSON.stringify(referralAmounts, null, 2));
    return referralAmounts;
};

function generateReferralCode(name) {
  const initials = (name || "AURA").replace(/[^a-zA-Z]/g, "").slice(0, 4).toUpperCase().padEnd(4, "X");
  const digits = Math.floor(1000 + Math.random() * 9000);
  return `${initials}${digits}`;
}

export const getReferralStats = async (userId, requesterId) => {
  let user = requesterId === userId ? await ReferralsRepository.getUserById(requesterId) : await ReferralsRepository.getUserById(userId);
  if (!user) throw new Error("User not found");

  if (!user.referralCode) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = generateReferralCode(user.name);
      try {
        user = await ReferralsRepository.updateReferralCode(user.id, candidate);
        break;
      } catch (err) {
        if (attempt === 4) throw err; 
      }
    }
  }

  const totalEarnings = await ReferralsRepository.getTotalEarnings(user.id);
  const referralRows = await ReferralsRepository.getReferralsByReferrer(user.id);
  
  const totalReferrals = referralRows.length;
  const completedReferrals = referralRows.filter(r => r.status === 'completed').length;
  const history = await ReferralsRepository.getWalletHistory(user.id);

  return {
    referralCode: user.referralCode,
    walletBalance: user.walletBalance || 0,
    stats: { totalEarnings, totalReferrals, completedReferrals },
    history: history,
  };
};

export const applyReferralCode = async (requester, code) => {
  if (requester.referredBy) {
    throw new Error("You've already used a referral code.");
  }

  const referrer = await ReferralsRepository.getUserByReferralCode(code.trim().toUpperCase());
  
  if (!referrer) throw new Error("That referral code doesn't exist.");
  if (referrer.id === requester.id) throw new Error("You can't refer yourself.");

  const hasExistingOrder = await ReferralsRepository.checkExistingOrder(requester.id);
  if (hasExistingOrder) {
    throw new Error("Referral codes can only be applied by new customers, before your first order.");
  }

  await ReferralsRepository.applyReferralTransaction(requester.id, referrer.id, referralAmounts);

  return referralAmounts.REFEREE_BONUS;
};

export const processReferralCompletion = async (userId, txOrDb) => {
  try {
    const referral = await ReferralsRepository.getPendingReferral(userId, txOrDb);
    if (!referral) return; 

    console.log(`🎁 Completing Referral: ${referral.referrerId} referred ${userId}`);

    const reward = referral.rewardAmount || 150;

    await ReferralsRepository.completeReferralTransaction(referral, reward, txOrDb);

    await createNotification(
      referral.referrerId,
      `You earned ₹${reward}! Your friend completed their first order.`,
      '/wallet',
      'wallet'
    );

  } catch (error) {
    console.error("❌ Referral Completion Error:", error);
  }
};

export const getAllReferrals = async () => {
  const allReferrals = await ReferralsRepository.getAllReferrals();

  const stats = {
    total: allReferrals.length,
    pending: allReferrals.filter(r => r.status === 'pending').length,
    completed: allReferrals.filter(r => r.status === 'completed').length,
    totalPayout: allReferrals
      .filter(r => r.status === 'completed')
      .reduce((acc, r) => acc + (r.rewardAmount || 0), 0)
  };

  return { referrals: allReferrals, stats };
};
