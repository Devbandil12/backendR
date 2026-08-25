import { Router } from 'express';
import * as AiController from './ai.controller.js';
import { ClerkExpressRequireAuth, ClerkExpressWithAuth } from '@clerk/clerk-sdk-node';
import { verifyAdmin } from '../../middleware/auth.js';

const router = Router();

// Customer AI Chat (Requires auth to enforce ownership of data during tool calls, but could be WithAuth for guests)
router.post('/chat', ClerkExpressWithAuth(), AiController.customerChat);

// Admin Copilot Endpoints
router.get('/admin/ticket/:ticketId/summarize', ClerkExpressRequireAuth(), verifyAdmin, AiController.summarizeTicket);
router.get('/admin/ticket/:ticketId/draft', ClerkExpressRequireAuth(), verifyAdmin, AiController.generateDraft);

export default router;
