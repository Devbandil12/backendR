// utils/notificationManager.js
import { db } from "../configs/index.js";
import { notificationsTable } from "../configs/schema.js";

/**
 * Creates a new notification for a user.
 * @param {string} userId - The UUID of the user.
 * @param {string} message - The notification text.
 * @param {string | null} link - An optional link (e.g., /myorder).
 * @param {string} type - The notification type (e.g., 'order', 'system').
 */
export const createNotification = async (userId, message, link = null, type = 'general') => {
  if (!userId || !message) return;
  
  try {
    await db.insert(notificationsTable).values({
      userId,
      message,
      link,
      type,
    });
    // We don't need to invalidate cache. The user will fetch
    // notifications via a dedicated API endpoint.
  } catch (error) {
    console.error(`❌ Failed to create notification for user ${userId}:`, error);
  }
};