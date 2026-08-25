import 'dotenv/config';
import express from 'express';
import { requireAuth, verifyAdmin } from "../../middleware/auth.js";
import * as NotificationsController from './notifications.controller.js';

const router = express.Router();

router.get('/user/:userId', requireAuth, NotificationsController.getUserNotifications);
router.put('/mark-read/user/:userId', requireAuth, NotificationsController.markNotificationsAsRead);
router.delete('/user/:userId', requireAuth, NotificationsController.clearNotifications);

router.post('/subscribe', requireAuth, NotificationsController.subscribePush);

router.post('/recover-abandoned', requireAuth, verifyAdmin, NotificationsController.recoverAbandoned);

export default router;
