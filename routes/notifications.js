// routes/notifications.js
import express from 'express';
import { db } from '../configs/index.js';
import { notificationsTable } from '../configs/schema.js';
import { eq, and, sql, desc } from 'drizzle-orm';

const router = express.Router();

// GET /api/notifications/user/:userId
// Fetches all notifications for a specific user
router.get('/user/:userId', async (req, res) => {
  const { userId } = req.params;
  
  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  try {
    // 1. Get the 20 most recent notifications
    const userNotifications = await db.query.notificationsTable.findMany({
      where: eq(notificationsTable.userId, userId),
      orderBy: [desc(notificationsTable.createdAt)],
      limit: 20,
    });

    // 2. Get the count of *only* unread notifications
    const unreadResult = await db.select({ 
        count: sql`count(*)::int` 
      })
      .from(notificationsTable)
      .where(and(
        eq(notificationsTable.userId, userId),
        eq(notificationsTable.isRead, false)
      ));

    res.json({
      notifications: userNotifications,
      unreadCount: unreadResult[0].count,
    });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/notifications/mark-read/user/:userId
// Marks all notifications for a user as read
router.put('/mark-read/user/:userId', async (req, res) => {
  const { userId } = req.params;

  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }
  
  try {
    await db.update(notificationsTable)
      .set({ isRead: true })
      .where(and(
        eq(notificationsTable.userId, userId),
        eq(notificationsTable.isRead, false)
      ));
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error marking notifications as read:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/user/:userId', async (req, res) => {
  const { userId } = req.params;

  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }
  
  try {
    // This deletes all rows for the user
    await db.delete(notificationsTable)
      .where(eq(notificationsTable.userId, userId));
    
    res.json({ success: true, message: "All notifications cleared." });
  } catch (error) {
    console.error('Error clearing notifications:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;