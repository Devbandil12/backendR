// src/modules/support/support.routes.js
// Enterprise support system routes

import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { requireAuth, verifyAdmin } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import * as ctrl from './support.controller.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// ── Multer config for attachments ─────────────────────────────────────────────
const SUPPORT_UPLOADS = path.resolve(__dirname, '../../../uploads/support');
if (!fs.existsSync(SUPPORT_UPLOADS)) fs.mkdirSync(SUPPORT_UPLOADS, { recursive: true });

const ALLOWED_MIMES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, SUPPORT_UPLOADS),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname);
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${unique}-${safeName}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIMES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} not allowed. Allowed: ${ALLOWED_MIMES.join(', ')}`), false);
    }
  },
});

// ── Rate limits ───────────────────────────────────────────────────────────────
const ticketCreationLimit = rateLimit({
  windowSeconds: 3600,
  max: 5,
  keyPrefix: 'rl:support-create',
  message: 'Too many tickets created. Please try again later.',
});

const replyLimit = rateLimit({
  windowSeconds: 60,
  max: 10,
  keyPrefix: 'rl:support-reply',
  message: 'Too many replies. Please slow down.',
});

const attachmentLimit = rateLimit({
  windowSeconds: 300,
  max: 10,
  keyPrefix: 'rl:support-attachment',
  message: 'Too many uploads. Please try again shortly.',
});

// ── Customer Routes ───────────────────────────────────────────────────────────
router.get('/stream', (req, res, next) => {
  if (req.query.token) {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }
  next();
}, requireAuth, ctrl.streamSupportEvents);
router.get('/me/tickets', requireAuth, ctrl.getMyTickets);
router.get('/me/tickets/:id', requireAuth, ctrl.getMyTicketById);
router.get('/me/tickets/:id/messages', requireAuth, ctrl.getMyTicketMessages);
router.post('/me/tickets', requireAuth, ticketCreationLimit, ctrl.createTicket);
router.post('/me/tickets/:id/messages', requireAuth, replyLimit, ctrl.customerReply);
router.post('/me/tickets/:id/attachments', requireAuth, attachmentLimit, ctrl.uploadAttachment);
router.post('/me/tickets/:id/attachments/presign', requireAuth, attachmentLimit, ctrl.getPresignedAttachmentUrl);
router.post('/me/tickets/:id/feedback', requireAuth, ctrl.submitCsatFeedback);

// Also support unauthenticated ticket creation (guest / ContactUs page)
router.post('/tickets/guest', ticketCreationLimit, ctrl.createTicket);

// Real-time typing indicators
router.post('/tickets/:id/typing', requireAuth, ctrl.sendTypingStatus);

// ── Admin Routes ──────────────────────────────────────────────────────────────
router.get('/analytics/csat', requireAuth, verifyAdmin, ctrl.getCsatAnalytics);
router.get('/tickets', requireAuth, verifyAdmin, ctrl.getTickets);
router.get('/tickets/counts', requireAuth, verifyAdmin, ctrl.getTicketCounts);
router.get('/tickets/:id', requireAuth, verifyAdmin, ctrl.getTicketById);
router.get('/tickets/:id/messages', requireAuth, verifyAdmin, ctrl.getTicketMessages);
router.get('/tickets/:id/events', requireAuth, verifyAdmin, ctrl.getTicketEvents);
router.post('/tickets/:id/messages', requireAuth, verifyAdmin, replyLimit, ctrl.adminReply);
router.post('/tickets/:id/notes', requireAuth, verifyAdmin, ctrl.addInternalNote);
router.post('/tickets/:id/attachments', requireAuth, verifyAdmin, attachmentLimit, ctrl.uploadAttachment);
router.post('/tickets/:id/attachments/presign', requireAuth, verifyAdmin, attachmentLimit, ctrl.getPresignedAttachmentUrl);
router.post('/tickets/:id/view', requireAuth, verifyAdmin, ctrl.registerTicketView);
router.delete('/tickets/:id/view', requireAuth, verifyAdmin, ctrl.unregisterTicketView);
router.patch('/tickets/:id/status', requireAuth, verifyAdmin, ctrl.updateStatus);
router.patch('/tickets/:id/priority', requireAuth, verifyAdmin, ctrl.updatePriority);
router.patch('/tickets/:id/assign', requireAuth, verifyAdmin, ctrl.assignTicket);
router.patch('/tickets/:id/tags', requireAuth, verifyAdmin, ctrl.updateTags);
router.patch('/tickets/:id/category', requireAuth, verifyAdmin, ctrl.updateCategory);
router.delete('/tickets/:id', requireAuth, verifyAdmin, ctrl.archiveTicket);

// ── Config Routes ─────────────────────────────────────────────────────────────
router.get('/teams', requireAuth, verifyAdmin, ctrl.getTeams);
router.post('/teams', requireAuth, verifyAdmin, ctrl.createTeam);
router.get('/tags', requireAuth, verifyAdmin, ctrl.getTags);
router.post('/tags', requireAuth, verifyAdmin, ctrl.createTag);
router.delete('/tags/:id', requireAuth, verifyAdmin, ctrl.deleteTag);
router.get('/agents', requireAuth, verifyAdmin, ctrl.getAdminAgents);
router.get('/agents/presence', requireAuth, verifyAdmin, ctrl.getAgentPresence);
router.get('/canned-responses', requireAuth, verifyAdmin, ctrl.getCannedResponses);
router.post('/canned-responses', requireAuth, verifyAdmin, ctrl.createCannedResponse);
router.patch('/canned-responses/:id', requireAuth, verifyAdmin, ctrl.updateCannedResponse);
router.delete('/canned-responses/:id', requireAuth, verifyAdmin, ctrl.deleteCannedResponse);
router.get('/analytics/performance', requireAuth, verifyAdmin, ctrl.getPerformanceAnalytics);

export default router;
