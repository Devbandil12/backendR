import * as NotificationsService from './notifications.service.js';

export const getUserNotifications = async (req, res) => {
  const { userId } = req.params;
  try {
    const result = await NotificationsService.getUserNotifications(req.auth.userId, userId);
    res.json(result);
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error('Error fetching notifications:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

export const markNotificationsAsRead = async (req, res) => {
  const { userId } = req.params;
  try {
    await NotificationsService.markNotificationsAsRead(req.auth.userId, userId);
    res.json({ success: true });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error('Error marking notifications as read:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

export const clearNotifications = async (req, res) => {
  const { userId } = req.params;
  try {
    await NotificationsService.clearNotifications(req.auth.userId, userId);
    res.json({ success: true, message: "All notifications cleared." });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error('Error clearing notifications:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

export const subscribePush = async (req, res) => {
  const subscription = req.body;
  if (!subscription) return res.status(400).json({ error: "Missing data" });

  try {
    await NotificationsService.subscribePush(req.auth.userId, subscription);
    res.status(201).json({ success: true });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error('Error in subscribePush:', error);
    res.status(500).json({ error: "Failed" });
  }
};

export const recoverAbandoned = async (req, res) => {
  const { userIds } = req.body;
  if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
    return res.status(400).json({ error: "No users provided" });
  }

  NotificationsService.executeRecoveryForUsers(userIds)
    .then(count => console.log(`✅ Background Process Finished: ${count} emails sent.`))
    .catch(err => console.error("❌ Background Process Error:", err));

  res.json({ success: true, message: `Recovery initiated for ${userIds.length} users!` });
};
