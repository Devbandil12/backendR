// src/modules/support/support.controller.js
// Thin controllers for enterprise support system

import * as supportService from './support.service.js';
import * as SupportRepo from './support.repository.js';
import * as supportSse from './support.sse.js';
import { checkIsAdmin } from './support.service.js';

// ── Customer Controllers ──────────────────────────────────────────────────────

export const getMyTickets = async (req, res) => {
  try {
    const user = await SupportRepo.getUserByClerkId(req.auth.userId);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const { page, limit } = req.query;
    const tickets = await supportService.getMyTickets(user.id, {
      page: Number(page) || 1,
      limit: Number(limit) || 20,
    });
    res.json(tickets);
  } catch (error) {
    console.error('❌ getMyTickets:', error);
    res.status(error.status || 500).json({ error: error.message || 'Server error' });
  }
};

export const getMyTicketById = async (req, res) => {
  try {
    const user = await SupportRepo.getUserByClerkId(req.auth.userId);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const ticket = await supportService.getTicketById(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    // Verify ownership
    if (ticket.userId !== user.id && ticket.guestEmail !== user.email) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    res.json(ticket);
  } catch (error) {
    console.error('❌ getMyTicketById:', error);
    res.status(error.status || 500).json({ error: error.message || 'Server error' });
  }
};

export const getMyTicketMessages = async (req, res) => {
  try {
    const user = await SupportRepo.getUserByClerkId(req.auth.userId);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const ticket = await supportService.getTicketById(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    if (ticket.userId !== user.id && ticket.guestEmail !== user.email) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { limit, before } = req.query;
    const messages = await supportService.getTicketMessages(req.params.id, {
      limit: Number(limit) || 50,
      before: before || undefined,
      includeInternal: false, // Customer never sees internal notes
    });
    res.json(messages);
  } catch (error) {
    console.error('❌ getMyTicketMessages:', error);
    res.status(error.status || 500).json({ error: error.message || 'Server error' });
  }
};

import { redis } from '../../config/redis.js';

export const createTicket = async (req, res, next) => {
  try {
    const idempotencyKey = req.headers['idempotency-key'];
    let cacheKey = null;

    if (idempotencyKey && req.auth?.userId) {
      cacheKey = `idempotency:${req.auth.userId}:${idempotencyKey}`;
      const cached = await redis.get(cacheKey);
      if (cached) {
        return res.status(200).json(JSON.parse(cached));
      }
    }

    const { email, message, subject, phone, name, category, subcategory, priority, relatedOrderId } = req.body;
    if (!email || !message) return res.status(400).json({ error: 'Email and message are required' });

    // If authenticated, attach userId
    let userId = null;
    if (req.auth?.userId) {
      const user = await SupportRepo.getUserByClerkId(req.auth.userId);
      userId = user?.id || null;
    }

    const ticket = await supportService.createTicket({
      email, message, subject, phone, name, category, subcategory, priority, relatedOrderId, userId,
    });

    if (cacheKey) {
      await redis.set(cacheKey, JSON.stringify(ticket), 'EX', 86400); // 24 hours
    }

    res.status(201).json(ticket);
  } catch (error) {
    next(error);
  }
};

export const customerReply = async (req, res) => {
  try {
    const idempotencyKey = req.headers['idempotency-key'];
    let cacheKey = null;

    if (idempotencyKey && req.auth?.userId) {
      cacheKey = `idempotency:${req.auth.userId}:${idempotencyKey}`;
      const cached = await redis.get(cacheKey);
      if (cached) {
        return res.status(200).json(JSON.parse(cached));
      }
    }

    const { message } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: 'Message is required' });

    const newMessage = await supportService.replyToTicket(req.auth.userId, req.params.id, message);

    if (cacheKey) {
      await redis.set(cacheKey, JSON.stringify(newMessage), 'EX', 86400); // 24 hours
    }

    res.status(201).json(newMessage);
  } catch (error) {
    console.error('❌ customerReply:', error);
    res.status(error.status || 500).json({ error: error.message || 'Server error' });
  }
};

// ── Admin Controllers ─────────────────────────────────────────────────────────

export const getTickets = async (req, res, next) => {
  try {
    let { status, priority, category, assignedAgentId, assignedTeamId, search, page, limit } = req.query;
    
    if (assignedAgentId === 'me') {
      const user = await SupportRepo.getUserByClerkId(req.auth.userId);
      assignedAgentId = user?.id;
    }

    const tickets = await supportService.getTickets({
      status, priority, category, assignedAgentId, assignedTeamId, search,
      page: Number(page) || 1,
      limit: Number(limit) || 30,
    });
    res.json(tickets);
  } catch (error) {
    next(error);
  }
};

export const getTicketById = async (req, res) => {
  try {
    const ticket = await supportService.getTicketById(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    res.json(ticket);
  } catch (error) {
    console.error('❌ getTicketById:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

export const getTicketMessages = async (req, res) => {
  try {
    const { limit, before } = req.query;
    const messages = await supportService.getTicketMessages(req.params.id, {
      limit: Number(limit) || 50,
      before: before || undefined,
      includeInternal: true, // Admins see everything
    });
    res.json(messages);
  } catch (error) {
    console.error('❌ getTicketMessages:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

export const getTicketEvents = async (req, res) => {
  try {
    const events = await supportService.getTicketEvents(req.params.id);
    res.json(events);
  } catch (error) {
    console.error('❌ getTicketEvents:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

export const adminReply = async (req, res) => {
  try {
    const { message } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: 'Message is required' });

    const newMessage = await supportService.replyToTicket(req.auth.userId, req.params.id, message);
    res.status(201).json(newMessage);
  } catch (error) {
    console.error('❌ adminReply:', error);
    res.status(error.status || 500).json({ error: error.message || 'Server error' });
  }
};

export const addInternalNote = async (req, res) => {
  try {
    const { note } = req.body;
    if (!note?.trim()) return res.status(400).json({ error: 'Note is required' });

    const newNote = await supportService.addInternalNote(req.auth.userId, req.params.id, note);
    res.status(201).json(newNote);
  } catch (error) {
    console.error('❌ addInternalNote:', error);
    res.status(error.status || 500).json({ error: error.message || 'Server error' });
  }
};

export const updateStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: 'Status is required' });

    const updated = await supportService.updateStatus(req.auth.userId, req.params.id, status);
    res.json(updated);
  } catch (error) {
    console.error('❌ updateStatus:', error);
    res.status(error.status || 500).json({ error: error.message || 'Server error' });
  }
};

export const updatePriority = async (req, res) => {
  try {
    const { priority } = req.body;
    if (!priority) return res.status(400).json({ error: 'Priority is required' });

    const updated = await supportService.updatePriority(req.auth.userId, req.params.id, priority);
    res.json(updated);
  } catch (error) {
    console.error('❌ updatePriority:', error);
    res.status(error.status || 500).json({ error: error.message || 'Server error' });
  }
};

export const assignTicket = async (req, res) => {
  try {
    const { agentId, teamId } = req.body;
    const updated = await supportService.assignTicket(req.auth.userId, req.params.id, { agentId, teamId });
    res.json(updated);
  } catch (error) {
    console.error('❌ assignTicket:', error);
    res.status(error.status || 500).json({ error: error.message || 'Server error' });
  }
};

export const updateTags = async (req, res) => {
  try {
    const { tags } = req.body;
    if (!Array.isArray(tags)) return res.status(400).json({ error: 'Tags must be an array' });

    const updated = await supportService.updateTags(req.auth.userId, req.params.id, tags);
    res.json(updated);
  } catch (error) {
    console.error('❌ updateTags:', error);
    res.status(error.status || 500).json({ error: error.message || 'Server error' });
  }
};

export const updateCategory = async (req, res) => {
  try {
    const { category, subcategory } = req.body;
    const updated = await supportService.updateCategory(req.auth.userId, req.params.id, category, subcategory);
    res.json(updated);
  } catch (error) {
    console.error('❌ updateCategory:', error);
    res.status(error.status || 500).json({ error: error.message || 'Server error' });
  }
};

export const archiveTicket = async (req, res) => {
  try {
    const updated = await supportService.archiveTicket(req.auth.userId, req.params.id);
    res.json(updated);
  } catch (error) {
    console.error('❌ archiveTicket:', error);
    res.status(error.status || 500).json({ error: error.message || 'Server error' });
  }
};

import { getPresignedUrl } from '../../infrastructure/storage/storage.service.js';
import crypto from 'crypto';

export const getPresignedAttachmentUrl = async (req, res) => {
  try {
    const { fileName, mimeType, messageId } = req.body;
    if (!fileName || !mimeType) {
      return res.status(400).json({ error: 'fileName and mimeType are required' });
    }

    const user = await SupportRepo.getUserByClerkId(req.auth.userId);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const ticket = await supportService.getTicketById(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    const isAdmin = await checkIsAdmin(req.auth.userId);
    if (!isAdmin) {
      if (ticket.userId !== user.id && ticket.guestEmail !== user.email) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }

    // Generate unique key
    const uniqueId = crypto.randomUUID();
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `support/${ticket.id}/${uniqueId}-${safeName}`;

    const presignedUrl = await getPresignedUrl(key, mimeType);

    // Save attachment metadata in db with "pending" status (optional, or just save immediately since the frontend will upload)
    // Actually, best practice is for frontend to upload to R2, then call another endpoint or this one to confirm.
    // For now, let's just return the presignedUrl and the key, and let frontend confirm upload by calling another endpoint,
    // or just let frontend upload and then pass `storageKey` to `uploadAttachment`.

    res.status(200).json({ presignedUrl, key, url: `https://${process.env.R2_CUSTOM_DOMAIN || 'r2.yourdomain.com'}/${key}` });
  } catch (error) {
    console.error('❌ getPresignedAttachmentUrl:', error);
    res.status(error.status || 500).json({ error: error.message || 'Server error' });
  }
};

export const uploadAttachment = async (req, res) => {
  try {
    const { storageKey, originalName, mimeType, size, url, messageId } = req.body;
    
    if (!storageKey || !originalName || !mimeType || !size || !url) {
      return res.status(400).json({ error: 'Attachment metadata is incomplete' });
    }

    const attachment = await supportService.addAttachmentRecord(
      req.auth.userId,
      req.params.id,
      { storageKey, originalName, mimeType, size, url },
      messageId || null,
    );
    res.status(201).json(attachment);
  } catch (error) {
    console.error('❌ uploadAttachment:', error);
    res.status(error.status || 500).json({ error: error.message || 'Server error' });
  }
};

// ── Config Controllers ────────────────────────────────────────────────────────

export const getTeams = async (req, res) => {
  try {
    res.json(await supportService.getTeams());
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

export const createTeam = async (req, res) => {
  try {
    const { name, description, color } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Team name is required' });
    const team = await supportService.createTeam({ name, description, color });
    res.status(201).json(team);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Server error' });
  }
};

export const getTags = async (req, res) => {
  try {
    res.json(await supportService.getTags());
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

export const createTag = async (req, res) => {
  try {
    const { name, color, description } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Tag name is required' });
    const tag = await supportService.createTag({ name, color, description });
    res.status(201).json(tag);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Server error' });
  }
};

export const deleteTag = async (req, res) => {
  try {
    await supportService.deleteTag(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

export const getTicketCounts = async (req, res, next) => {
  try {
    const user = await SupportRepo.getUserByClerkId(req.auth.userId);
    const counts = await supportService.getTicketCounts(user?.id);
    res.json(counts);
  } catch (error) {
    next(error);
  }
};

export const getAdminAgents = async (req, res) => {
  try {
    const agents = await supportService.getAdminUsers();
    res.json(agents);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

export const streamSupportEvents = async (req, res) => {
  const clerkId = req.auth?.userId;
  if (!clerkId) {
    return res.status(401).end();
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  
  res.write('\n');

  try {
    const isAdmin = await checkIsAdmin(clerkId);
    const role = isAdmin ? 'admin' : 'user';
    
    supportSse.addSseClient(clerkId, role, res);

    req.on('close', () => {
      supportSse.removeSseClient(clerkId, res);
    });
  } catch (err) {
    console.error('❌ SSE Error:', err);
    res.end();
  }
};

export const submitCsatFeedback = async (req, res) => {
  try {
    const { rating, comment } = req.body;
    const ticketId = req.params.id;
    
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be an integer between 1 and 5' });
    }

    const user = await SupportRepo.getUserByClerkId(req.auth.userId);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const ticket = await SupportRepo.getTicketById(ticketId);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    const isOwner = (ticket.userId === user.id) || (ticket.guestEmail === user.email);
    if (!isOwner) return res.status(403).json({ error: 'Forbidden' });

    if (ticket.status !== 'resolved' && ticket.status !== 'closed') {
      return res.status(400).json({ error: 'Feedback can only be submitted for resolved or closed tickets' });
    }

    const csat = await SupportRepo.insertCsatFeedback({
      ticketId,
      userId: user.id,
      rating: Number(rating),
      comment: comment || null
    });

    await SupportRepo.insertEvent({
      ticketId,
      actorId: user.id,
      actorRole: 'user',
      eventType: 'CSAT_SUBMITTED',
      toValue: `${rating} Stars`,
      metadata: { comment: comment?.substring(0, 100) }
    });

    await SupportRepo.insertMessage({
      ticketId,
      senderRole: 'system',
      messageType: 'system_event',
      message: `CSAT Rating Submitted: ${rating} / 5 ★. Comment: ${comment || 'No comment'}`
    });

    supportSse.broadcastToAdmins({ event: 'csat_submitted', ticketId, rating });

    res.status(201).json(csat);
  } catch (error) {
    console.error('❌ submitCsatFeedback:', error);
    res.status(500).json({ error: error.message || 'Server error' });
  }
};

export const getCsatAnalytics = async (req, res) => {
  try {
    const stats = await SupportRepo.getCsatStats();
    res.json(stats);
  } catch (error) {
    console.error('❌ getCsatAnalytics:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// ── Removed Duplicate Canned Responses Controllers ──────────────────────────────

// ── Presence & Performance Analytics Controllers ──────────────────────────────

export const getAgentPresence = async (req, res) => {
  try {
    const list = await supportService.getAgentPresence();
    res.json(list);
  } catch (error) {
    console.error('❌ getAgentPresence:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

export const getPerformanceAnalytics = async (req, res) => {
  try {
    const metrics = await supportService.getPerformanceAnalytics();
    res.json(metrics);
  } catch (error) {
    console.error('❌ getPerformanceAnalytics:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

export const sendTypingStatus = async (req, res) => {
  try {
    const { isTyping } = req.body;
    const ticketId = req.params.id;

    const user = await SupportRepo.getUserByClerkId(req.auth.userId);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const ticket = await SupportRepo.getTicketById(ticketId);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    const isAdmin = await checkIsAdmin(req.auth.userId);
    
    const payload = {
      event: 'typing',
      ticketId,
      actorName: user.name,
      isTyping: !!isTyping,
    };

    if (isAdmin) {
      if (ticket.userId) {
        await supportSse.broadcastToUser(ticket.userId, payload);
      }
    } else {
      supportSse.broadcastToAdmins(payload);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('❌ sendTypingStatus:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

export const registerTicketView = async (req, res) => {
  try {
    const ticketId = req.params.id;
    const clerkId = req.auth.userId;

    const user = await SupportRepo.getUserByClerkId(clerkId);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    supportSse.addTicketViewer(ticketId, clerkId, user);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ registerTicketView:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

export const unregisterTicketView = async (req, res) => {
  try {
    const ticketId = req.params.id;
    const clerkId = req.auth.userId;

    supportSse.removeTicketViewer(ticketId, clerkId);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ unregisterTicketView:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// ── Canned Responses ──────────────────────────────────────────────────────────
export const getCannedResponses = async (req, res) => {
  try {
    const clerkId = req.auth.userId;
    const user = await SupportRepo.getUserByClerkId(clerkId);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const responses = await SupportRepo.getCannedResponses(user.id);
    res.json(responses);
  } catch (error) {
    console.error('❌ getCannedResponses:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

export const createCannedResponse = async (req, res) => {
  try {
    const { shortcut, title, content, scope } = req.body;
    
    if (!shortcut || !title || !content) {
      return res.status(400).json({ error: 'Shortcut, title, and content are required' });
    }
    
    const clerkId = req.auth.userId;
    const user = await SupportRepo.getUserByClerkId(clerkId);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    
    let finalScope = 'PERSONAL';
    if (scope === 'GLOBAL') {
      const { resolveEffectivePermissions } = await import('../../middleware/rbac.js');
      const perms = await resolveEffectivePermissions(clerkId);
      if (perms.includes('admin:all') || perms.includes('support:manage')) {
        finalScope = 'GLOBAL';
      } else {
        return res.status(403).json({ error: 'You do not have permission to create global templates' });
      }
    }

    let finalShortcut = shortcut.trim().toLowerCase();
    if (!finalShortcut.startsWith('/')) finalShortcut = '/' + finalShortcut;

    const response = await SupportRepo.insertCannedResponse({
      shortcut: finalShortcut,
      title: title.trim(),
      content: content.trim(),
      scope: finalScope,
      createdBy: user.id
    });

    res.status(201).json(response);
  } catch (error) {
    console.error('❌ createCannedResponse:', error);
    if (error.code === '23505') { // unique violation
      return res.status(409).json({ error: 'A template with this shortcut already exists in this scope' });
    }
    res.status(500).json({ error: 'Server error' });
  }
};

export const updateCannedResponse = async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;
    
    const clerkId = req.auth.userId;
    const user = await SupportRepo.getUserByClerkId(clerkId);
    
    const existing = await SupportRepo.getCannedResponseById(id);
    if (!existing) return res.status(404).json({ error: 'Template not found' });
    
    if (existing.scope === 'GLOBAL') {
      const { resolveEffectivePermissions } = await import('../../middleware/rbac.js');
      const perms = await resolveEffectivePermissions(clerkId);
      if (!perms.includes('admin:all') && !perms.includes('support:manage')) {
        return res.status(403).json({ error: 'You do not have permission to edit global templates' });
      }
    } else if (existing.createdBy !== user.id) {
      return res.status(403).json({ error: 'You can only edit your own personal templates' });
    }
    
    if (data.shortcut) {
      data.shortcut = data.shortcut.trim().toLowerCase();
      if (!data.shortcut.startsWith('/')) data.shortcut = '/' + data.shortcut;
    }

    const response = await SupportRepo.updateCannedResponse(id, data);
    res.json(response);
  } catch (error) {
    console.error('❌ updateCannedResponse:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

export const deleteCannedResponse = async (req, res) => {
  try {
    const { id } = req.params;
    
    const clerkId = req.auth.userId;
    const user = await SupportRepo.getUserByClerkId(clerkId);
    
    const existing = await SupportRepo.getCannedResponseById(id);
    if (!existing) return res.status(404).json({ error: 'Template not found' });
    
    if (existing.scope === 'GLOBAL') {
      const { resolveEffectivePermissions } = await import('../../middleware/rbac.js');
      const perms = await resolveEffectivePermissions(clerkId);
      if (!perms.includes('admin:all') && !perms.includes('support:manage')) {
        return res.status(403).json({ error: 'You do not have permission to delete global templates' });
      }
    } else if (existing.createdBy !== user.id) {
      return res.status(403).json({ error: 'You can only delete your own personal templates' });
    }
    
    await SupportRepo.deleteCannedResponse(id);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ deleteCannedResponse:', error);
    res.status(500).json({ error: 'Server error' });
  }
};
