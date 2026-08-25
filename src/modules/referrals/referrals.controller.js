import * as ReferralsService from './referrals.service.js';
import * as ReferralsRepository from './referrals.repository.js';

export const getStats = async (req, res) => {
  try {
    const { userId } = req.params;
    const requester = await ReferralsRepository.getUserByClerkId(req.auth.userId);
    if (!requester) return res.status(401).json({ error: "Unauthorized" });

    if (userId !== requester.id && requester.role !== 'admin') {
      return res.status(403).json({ error: "Forbidden" }); 
    }

    try {
        const stats = await ReferralsService.getReferralStats(userId, requester.id);
        res.json(stats);
    } catch (e) {
        if (e.message === "User not found") {
            return res.status(404).json({ error: "User not found" });
        }
        throw e;
    }

  } catch (error) {
    console.error("❌ Referral Stats Error:", error);
    res.status(500).json({ error: "Failed to fetch referral stats" });
  }
};

export const applyReferralCode = async (req, res) => {
  try {
    const { code } = req.body; 
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: "Please enter a referral code." });
    }

    const requester = await ReferralsRepository.getUserByClerkId(req.auth.userId);
    if (!requester) return res.status(401).json({ error: "Unauthorized" });

    try {
        const bonus = await ReferralsService.applyReferralCode(requester, code);
        res.json({
            success: true,
            message: `Code applied! ₹${bonus} added to your wallet. Your friend gets theirs once you complete your first order.`,
        });
    } catch (e) {
        return res.status(400).json({ error: e.message });
    }

  } catch (error) {
    console.error("❌ Referral Apply Error:", error);
    res.status(500).json({ error: "Failed to apply referral code." });
  }
};

export const getAllReferrals = async (req, res) => {
  try {
    const data = await ReferralsService.getAllReferrals();
    res.json(data);
  } catch (error) {
    console.error("Admin Referral Fetch Error:", error);
    res.status(500).json({ error: "Failed to fetch referrals" });
  }
};

export const getConfig = async (req, res) => {
  try {
    res.json(ReferralsService.getConfig());
  } catch (error) {
    console.error("Config Fetch Error:", error);
    res.status(500).json({ error: "Failed to fetch config" });
  }
};

export const updateConfig = async (req, res) => {
  try {
    const { REFEREE_BONUS, REFERRER_BONUS } = req.body;
    const newConfig = {
      REFEREE_BONUS: Number(REFEREE_BONUS),
      REFERRER_BONUS: Number(REFERRER_BONUS)
    };
    const updated = ReferralsService.updateConfig(newConfig);
    res.json({ success: true, message: "Config updated successfully", data: updated });
  } catch (error) {
    console.error("Config Update Error:", error);
    res.status(500).json({ error: "Failed to update config" });
  }
};

export const processReferralCompletion = ReferralsService.processReferralCompletion;
