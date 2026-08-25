import { Router } from 'express';
import { getAuditLogs } from './audit.controller.js';
import { withAuth, verifyAdmin } from '../../middleware/auth.js';

const router = Router();

// Only Admins can access audit logs
router.get('/', withAuth, verifyAdmin, getAuditLogs);

export default router;
