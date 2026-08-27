import * as RewardsService from './rewards.service.js';
import fs from 'fs';
import { db } from "../../db/client.js";
import { usersTable } from "../../db/schema/index.js";
import { eq } from "drizzle-orm";

import { getUserWithRole } from "../../middleware/rbac.js";

const getUserFromToken = getUserWithRole;

export const getConfig = async (req, res) => {
  try {
    const config = await RewardsService.getRewardValues();
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch config" });
  }
};

export const updateConfig = async (req, res) => {
  const { paparazzi, loyal_follower, reviewer, monthly_lottery } = req.body;
  if (!paparazzi || !loyal_follower || !reviewer || !monthly_lottery) {
    return res.status(400).json({ error: "Missing values" });
  }

  try {
    await RewardsService.updateRewardConfig(req.body);
    res.json({ success: true, config: req.body });
  } catch (error) {
    console.error("Reward Config Save Error:", error);
    res.status(500).json({ error: "Database error" });
  }
};

export const getMyHistory = async (req, res) => {
  try {
    const { userId } = req.params;
    const requester = await getUserFromToken(req.auth.userId);
    if (!requester) return res.status(401).json({ error: "Unauthorized" });

    if (userId !== requester.id && requester.role !== 'admin') {
        return res.status(403).json({ error: "Forbidden" });
    }

    const claims = await RewardsService.getUserHistory(userId);
    res.json({ success: true, data: claims });
  } catch (error) {
    console.error("History Fetch Error:", error);
    res.status(500).json({ error: "Failed to fetch history" });
  }
};

export const claimReward = async (req, res) => {
  let tempFilePath = null;
  
  try {
    const { taskType, handle } = req.body; 
    const file = req.file;
    tempFilePath = file ? file.path : null;
    const originalFileName = file ? file.filename : null;

    if (!taskType) return res.status(400).json({ error: "Missing task type" });

    const user = await getUserFromToken(req.auth.userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    const { status, rewardAmount } = await RewardsService.processClaim(
      user, taskType, handle, tempFilePath, originalFileName
    );

    if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    
    res.json({ 
        success: true, 
        message: status === 'approved' ? `⚡ Verified! ₹${rewardAmount} added instantly.` : "Proof uploaded! Under review." 
    });

  } catch (error) {
    if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    if (["You have already completed or submitted this task!", "You are already entered for this month!", "No Verified Buyer photo review found on your profile."].includes(error.message)) {
      return res.status(400).json({ error: error.message });
    }
    console.error("Claim Error:", error);
    res.status(500).json({ error: "Server Error" });
  }
};

export const getPendingClaims = async (req, res) => {
  try {
    const pendingClaims = await RewardsService.getPendingClaims();
    res.json(pendingClaims);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch claims" });
  }
};

export const pickLotteryWinner = async (req, res) => {
  try {
    const winnerData = await RewardsService.pickLotteryWinner();
    res.json({
      message: "Winner Selected",
      ...winnerData
    });
  } catch (error) { 
      if (error.message === "No pending entries found.") {
        return res.status(400).json({ error: error.message });
      }
      console.error("Pick Winner Error:", error);
      res.status(500).json({ error: "Failed to pick winner" }); 
  }
};

export const decideClaim = async (req, res) => {
    try {
        const { claimId, decision } = req.body;
        const actor = await getUserFromToken(req.auth.userId);
        
        await RewardsService.decideClaim(claimId, decision, actor?.id);
        
        res.json({ success: true, message: "Decision recorded" });
  } catch (error) { 
    if (error.message === "Invalid decision" || error.message === "Invalid or processed claim") {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: error.message }); 
  }
};

export const getLotteryHistory = async (req, res) => {
  try {
    const history = await RewardsService.getLotteryHistory();
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
