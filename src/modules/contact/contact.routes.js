// src/modules/contact/contact.routes.js
import express from 'express';
import { requireAuth, verifyAdmin } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import * as contactController from './contact.controller.js';

const router = express.Router();

const checkRateLimit = rateLimit({
  windowSeconds: 3600,
  max: 3,
  keyPrefix: 'rl:contact-tickets',
  message: 'Too many tickets created. Please try again later.'
});



router.get('/', requireAuth, verifyAdmin, contactController.getAllTickets);
router.get('/user/:email', requireAuth, contactController.getUserTickets);
router.post('/', checkRateLimit, contactController.createTicket);
router.post('/:ticketId/reply', requireAuth, contactController.replyToTicket);
router.patch('/:ticketId/status', requireAuth, verifyAdmin, contactController.updateTicketStatus);

export default router;
