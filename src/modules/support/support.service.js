// src/modules/support/support.service.js
// Business logic for enterprise support system

import * as SupportRepo from './support.repository.js';
import * as supportSse from './support.sse.js';
import nodemailer from 'nodemailer';
import crypto from 'crypto';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

// ── Constants ─────────────────────────────────────────────────────────────────
export const VALID_STATUSES = [
  'new', 'open', 'in_progress', 'waiting_for_customer',
  'pending', 'resolved', 'closed', 'reopened', 'spam',
];

export const VALID_PRIORITIES = ['low', 'normal', 'high', 'urgent', 'critical'];

export const SLA_TARGETS = {
  critical: { firstResponseMs: 15 * 60 * 1000, resolutionMs: 2 * 60 * 60 * 1000 },
  urgent: { firstResponseMs: 60 * 60 * 1000, resolutionMs: 4 * 60 * 60 * 1000 },
  high: { firstResponseMs: 2 * 60 * 60 * 1000, resolutionMs: 8 * 60 * 60 * 1000 },
  normal: { firstResponseMs: 8 * 60 * 60 * 1000, resolutionMs: 24 * 60 * 60 * 1000 },
  low: { firstResponseMs: 24 * 60 * 60 * 1000, resolutionMs: 72 * 60 * 60 * 1000 },
};

export function calculateSLADeadlines(createdAtDate, priority) {
  const p = priority && SLA_TARGETS[priority] ? priority : 'normal';
  const target = SLA_TARGETS[p];
  const baseTime = createdAtDate instanceof Date ? createdAtDate.getTime() : new Date(createdAtDate).getTime();
  
  return {
    firstResponseDueAt: new Date(baseTime + target.firstResponseMs),
    resolutionDueAt: new Date(baseTime + target.resolutionMs),
  };
}

export const VALID_CATEGORIES = [
  'orders', 'payments', 'shipping', 'products', 'account', 'offers', 'other',
];

export const SUBCATEGORIES = {
  orders: ['order_status', 'cancellation', 'return', 'refund'],
  payments: ['payment_failed', 'double_payment', 'refund_pending'],
  shipping: ['delivery_delayed', 'address_issue', 'tracking'],
  products: ['product_question', 'damaged_product', 'missing_item'],
  account: ['login', 'profile', 'phone_verification'],
  offers: ['coupon', 'rewards', 'referral'],
  other: [],
};

// ── Ticket ID Status Transitions ──────────────────────────────────────────────
const ALLOWED_TRANSITIONS = {
  new: ['open', 'in_progress', 'spam', 'closed'],
  open: ['in_progress', 'waiting_for_customer', 'pending', 'resolved', 'closed', 'spam'],
  in_progress: ['waiting_for_customer', 'pending', 'resolved', 'closed', 'open'],
  waiting_for_customer: ['open', 'in_progress', 'resolved', 'closed'],
  pending: ['open', 'in_progress', 'resolved', 'closed'],
  resolved: ['closed', 'reopened'],
  closed: ['reopened'],
  reopened: ['open', 'in_progress', 'waiting_for_customer', 'resolved', 'closed'],
  spam: ['open'],
};

// ── Create Ticket ─────────────────────────────────────────────────────────────
export async function createTicket({ email, phone, name, subject, message, category, subcategory, priority: priorityInput, relatedOrderId, userId }) {
  const ticketNumber = await SupportRepo.generateTicketNumber();
  const priority = priorityInput && VALID_PRIORITIES.includes(priorityInput) ? priorityInput : 'normal';
  const createdAt = new Date();
  const deadlines = calculateSLADeadlines(createdAt, priority);

  // Automated routing mapping
  const ROUTING_MAP = {
    payments: 'Payments & Billing',
    orders: 'Orders',
    shipping: 'Logistics',
    products: 'Technical Support',
    technical: 'Technical Support',
  };

  let assignedTeamId = null;
  let routedTeamName = 'Customer Support';
  if (category && ROUTING_MAP[category]) {
    routedTeamName = ROUTING_MAP[category];
  }

  const matchedTeam = await SupportRepo.getTeamByName(routedTeamName);
  if (matchedTeam) {
    assignedTeamId = matchedTeam.id;
  }

  const adminUsers = await SupportRepo.getAdminUsers();
  
  // Filter for ONLY agents currently connected to SSE
  const onlineClerkIds = supportSse.getOnlineClerkIds();
  const onlineAdmins = adminUsers.filter(admin => onlineClerkIds.includes(admin.clerkId));

  const ticketData = {
    ticketNumber,
    userId: userId || null,
    guestEmail: email,
    guestPhone: phone || null,
    guestName: name || null,
    subject: subject || 'New Support Query',
    status: 'new',
    priority,
    category: category && VALID_CATEGORIES.includes(category) ? category : null,
    subcategory: subcategory || null,
    relatedOrderId: relatedOrderId || null,
    channel: 'web',
    tags: [],
    assignedTeamId,
    firstResponseDueAt: deadlines.firstResponseDueAt,
    resolutionDueAt: deadlines.resolutionDueAt,
    createdAt,
    updatedAt: createdAt,
  };

  const firstMessage = {
    senderRole: 'user',
    senderId: userId || null,
    messageType: 'customer',
    message,
  };

  const eventData = {
    actorId: userId || null,
    actorRole: 'user',
    eventType: 'TICKET_CREATED',
    toValue: 'new',
    metadata: { email, subject },
  };

  const outboxEventData = {
    id: crypto.randomUUID(),
    eventType: 'TICKET_CREATED',
    payload: { ticketData, firstMessage, name, email, subject, message },
  };

  const { ticket, message: savedMessage } = await SupportRepo.createTicket(ticketData, firstMessage, eventData, outboxEventData, onlineAdmins);

  // Real-time broadcast
  supportSse.broadcastToAdmins({ event: 'ticket_created', ticketId: ticket.id, ticketNumber: ticket.ticketNumber });

  // Send emails asynchronously (don't block the response)
  sendTicketCreationEmails(ticket, name, email, subject, message).catch(err => {
    console.error('⚠️ Failed to send creation emails:', err.message);
  });

  return ticket;
}

// ── Reply to Ticket ───────────────────────────────────────────────────────────
export async function replyToTicket(clerkId, ticketId, messageText) {
  const actor = await SupportRepo.getUserByClerkId(clerkId);
  if (!actor) throw Object.assign(new Error('Unauthorized'), { status: 401 });

  const ticket = await SupportRepo.getTicketById(ticketId);
  if (!ticket) throw Object.assign(new Error('Ticket not found'), { status: 404 });
  if (ticket.status === 'closed' || ticket.status === 'spam') {
    throw Object.assign(new Error('This ticket is closed and cannot receive new messages.'), { status: 400 });
  }

  // Determine sender role by checking if they have an admin role
  const isAdmin = await checkIsAdmin(clerkId);
  let senderRole = 'user';
  let messageType = 'customer';

  if (isAdmin) {
    senderRole = 'admin';
    messageType = 'agent';
  } else {
    // Verify customer ownership
    const isOwner = (ticket.userId === actor.id) || (ticket.guestEmail === actor.email);
    if (!isOwner) throw Object.assign(new Error('Forbidden: Not your ticket'), { status: 403 });
  }

  const messageData = {
    ticketId, senderRole, senderId: actor.id, messageType, message: messageText,
  };

  const eventData = {
    ticketId, actorId: actor.id, actorRole: senderRole,
    eventType: 'MESSAGE_ADDED', metadata: { messageType },
  };

  const updateData = { updatedAt: new Date() };

  // Auto-transition status based on who replied
  if (isAdmin) {
    if (!ticket.firstResponseAt) {
      const responseTime = new Date();
      updateData.firstResponseAt = responseTime;
      if (ticket.firstResponseDueAt && responseTime > new Date(ticket.firstResponseDueAt)) {
        updateData.isFirstResponseBreached = true;
      }
    }
    if (ticket.status === 'new') updateData.status = 'open';
  } else {
    if (ticket.status === 'waiting_for_customer') updateData.status = 'open';
    if (ticket.status === 'resolved') updateData.status = 'reopened';
  }

  const outboxEventData = {
    id: crypto.randomUUID(),
    eventType: 'TICKET_REPLY',
    payload: { ticket, messageText, senderRole },
  };

  const newMessage = await SupportRepo.replyToTicket(ticketId, messageData, eventData, updateData, outboxEventData);

  // Real-time broadcast
  if (ticket.userId) supportSse.broadcastToUser(ticket.userId, { event: 'message_added', ticketId });
  supportSse.broadcastToAdmins({ event: 'message_added', ticketId });

  return newMessage;
}

// ── Add Internal Note ─────────────────────────────────────────────────────────
export async function addInternalNote(clerkId, ticketId, noteText) {
  const actor = await SupportRepo.getUserByClerkId(clerkId);
  if (!actor) throw Object.assign(new Error('Unauthorized'), { status: 401 });

  const isAdmin = await checkIsAdmin(clerkId);
  if (!isAdmin) throw Object.assign(new Error('Forbidden: Only agents can add internal notes'), { status: 403 });

  const ticket = await SupportRepo.getTicketById(ticketId);
  if (!ticket) throw Object.assign(new Error('Ticket not found'), { status: 404 });

  const note = await SupportRepo.insertMessage({
    ticketId, senderRole: 'admin', senderId: actor.id,
    messageType: 'internal_note', message: noteText,
  });

  await SupportRepo.insertEvent({
    ticketId, actorId: actor.id, actorRole: 'admin',
    eventType: 'NOTE_ADDED', metadata: { preview: noteText.substring(0, 100) },
  });

  await SupportRepo.updateTicket(ticketId, { updatedAt: new Date() });

  // Real-time broadcast
  supportSse.broadcastToAdmins({ event: 'note_added', ticketId });

  return note;
}

// ── Update Status ─────────────────────────────────────────────────────────────
export async function updateStatus(clerkId, ticketId, newStatus) {
  const actor = await SupportRepo.getUserByClerkId(clerkId);
  if (!actor) throw Object.assign(new Error('Unauthorized'), { status: 401 });

  const isAdmin = await checkIsAdmin(clerkId);
  if (!isAdmin) throw Object.assign(new Error('Forbidden: Only agents can change ticket status'), { status: 403 });

  if (!VALID_STATUSES.includes(newStatus)) {
    throw Object.assign(new Error(`Invalid status: ${newStatus}`), { status: 400 });
  }

  const ticket = await SupportRepo.getTicketById(ticketId);
  if (!ticket) throw Object.assign(new Error('Ticket not found'), { status: 404 });

  const allowed = ALLOWED_TRANSITIONS[ticket.status];
  if (!allowed?.includes(newStatus)) {
    throw Object.assign(new Error(`Cannot transition from ${ticket.status} to ${newStatus}`), { status: 400 });
  }

  const updateData = { status: newStatus };
  if (newStatus === 'resolved') {
    const resolutionTime = new Date();
    updateData.resolvedAt = resolutionTime;
    if (ticket.resolutionDueAt && resolutionTime > new Date(ticket.resolutionDueAt)) {
      updateData.isResolutionBreached = true;
    }
  }
  if (newStatus === 'reopened') {
    updateData.resolvedAt = null;
    updateData.isResolutionBreached = false;
  }

  await SupportRepo.insertEvent({
    ticketId, actorId: actor.id, actorRole: 'admin',
    eventType: 'STATUS_CHANGED', fromValue: ticket.status, toValue: newStatus,
  });

  // Add a system message for visibility in the conversation
  await SupportRepo.insertMessage({
    ticketId, senderRole: 'admin', senderId: actor.id,
    messageType: 'system_event',
    message: `Status changed from ${formatStatus(ticket.status)} to ${formatStatus(newStatus)}`,
  });

  const updated = await SupportRepo.updateTicket(ticketId, updateData);

  // Real-time broadcast
  if (ticket.userId) supportSse.broadcastToUser(ticket.userId, { event: 'status_changed', ticketId, status: newStatus });
  supportSse.broadcastToAdmins({ event: 'status_changed', ticketId, status: newStatus });

  return updated;
}

// ── Update Priority ───────────────────────────────────────────────────────────
export async function updatePriority(clerkId, ticketId, newPriority) {
  const actor = await SupportRepo.getUserByClerkId(clerkId);
  if (!actor) throw Object.assign(new Error('Unauthorized'), { status: 401 });

  const isAdmin = await checkIsAdmin(clerkId);
  if (!isAdmin) throw Object.assign(new Error('Forbidden'), { status: 403 });

  if (!VALID_PRIORITIES.includes(newPriority)) {
    throw Object.assign(new Error(`Invalid priority: ${newPriority}`), { status: 400 });
  }

  const ticket = await SupportRepo.getTicketById(ticketId);
  if (!ticket) throw Object.assign(new Error('Ticket not found'), { status: 404 });

  await SupportRepo.insertEvent({
    ticketId, actorId: actor.id, actorRole: 'admin',
    eventType: 'PRIORITY_CHANGED', fromValue: ticket.priority, toValue: newPriority,
  });

  const deadlines = calculateSLADeadlines(ticket.createdAt, newPriority);
  const updateData = {
    priority: newPriority,
    firstResponseDueAt: deadlines.firstResponseDueAt,
    resolutionDueAt: deadlines.resolutionDueAt,
  };

  if (!ticket.firstResponseAt) {
    updateData.isFirstResponseBreached = new Date() > deadlines.firstResponseDueAt;
  }
  if (!ticket.resolvedAt) {
    updateData.isResolutionBreached = new Date() > deadlines.resolutionDueAt;
  }

  return await SupportRepo.updateTicket(ticketId, updateData);
}

// ── Assign Ticket ─────────────────────────────────────────────────────────────
export async function assignTicket(clerkId, ticketId, { agentId, teamId }) {
  const actor = await SupportRepo.getUserByClerkId(clerkId);
  if (!actor) throw Object.assign(new Error('Unauthorized'), { status: 401 });

  const isAdmin = await checkIsAdmin(clerkId);
  if (!isAdmin) throw Object.assign(new Error('Forbidden'), { status: 403 });

  const ticket = await SupportRepo.getTicketById(ticketId);
  if (!ticket) throw Object.assign(new Error('Ticket not found'), { status: 404 });

  const updateData = {};
  const eventMetadata = {};

  if (agentId !== undefined) {
    updateData.assignedAgentId = agentId || null;
    if (agentId) {
      const agent = await SupportRepo.getUserById(agentId);
      eventMetadata.agentName = agent?.name;
    }
  }

  if (teamId !== undefined) {
    updateData.assignedTeamId = teamId || null;
  }

  await SupportRepo.insertEvent({
    ticketId, actorId: actor.id, actorRole: 'admin',
    eventType: agentId ? 'ASSIGNED' : (agentId === null ? 'UNASSIGNED' : 'TEAM_CHANGED'),
    fromValue: ticket.assignedAgentId || null,
    toValue: agentId || teamId || null,
    metadata: eventMetadata,
  });

  // If ticket is NEW and being assigned, auto-open
  if (ticket.status === 'new' && (agentId || teamId)) {
    updateData.status = 'open';
    await SupportRepo.insertEvent({
      ticketId, actorId: actor.id, actorRole: 'admin',
      eventType: 'STATUS_CHANGED', fromValue: 'new', toValue: 'open',
    });
  }

  return await SupportRepo.updateTicket(ticketId, updateData);
}

// ── Update Tags ───────────────────────────────────────────────────────────────
export async function updateTags(clerkId, ticketId, tags) {
  const actor = await SupportRepo.getUserByClerkId(clerkId);
  if (!actor) throw Object.assign(new Error('Unauthorized'), { status: 401 });

  const isAdmin = await checkIsAdmin(clerkId);
  if (!isAdmin) throw Object.assign(new Error('Forbidden'), { status: 403 });

  const ticket = await SupportRepo.getTicketById(ticketId);
  if (!ticket) throw Object.assign(new Error('Ticket not found'), { status: 404 });

  await SupportRepo.insertEvent({
    ticketId, actorId: actor.id, actorRole: 'admin',
    eventType: 'TAG_ADDED',
    fromValue: JSON.stringify(ticket.tags || []),
    toValue: JSON.stringify(tags),
  });

  return await SupportRepo.updateTicket(ticketId, { tags });
}

// ── Update Category ───────────────────────────────────────────────────────────
export async function updateCategory(clerkId, ticketId, category, subcategory) {
  const actor = await SupportRepo.getUserByClerkId(clerkId);
  if (!actor) throw Object.assign(new Error('Unauthorized'), { status: 401 });

  const isAdmin = await checkIsAdmin(clerkId);
  if (!isAdmin) throw Object.assign(new Error('Forbidden'), { status: 403 });

  if (category && !VALID_CATEGORIES.includes(category)) {
    throw Object.assign(new Error(`Invalid category: ${category}`), { status: 400 });
  }

  return await SupportRepo.updateTicket(ticketId, { category, subcategory: subcategory || null });
}

// ── Soft Delete (Archive) ─────────────────────────────────────────────────────
export async function archiveTicket(clerkId, ticketId) {
  const actor = await SupportRepo.getUserByClerkId(clerkId);
  if (!actor) throw Object.assign(new Error('Unauthorized'), { status: 401 });

  const isAdmin = await checkIsAdmin(clerkId);
  if (!isAdmin) throw Object.assign(new Error('Forbidden'), { status: 403 });

  await SupportRepo.insertEvent({
    ticketId, actorId: actor.id, actorRole: 'admin', eventType: 'ARCHIVED',
  });

  return await SupportRepo.updateTicket(ticketId, { archivedAt: new Date(), status: 'closed' });
}

// ── Upload Attachment ─────────────────────────────────────────────────────────
export async function addAttachmentRecord(clerkId, ticketId, metadata, messageId) {
  const actor = await SupportRepo.getUserByClerkId(clerkId);
  if (!actor) throw Object.assign(new Error('Unauthorized'), { status: 401 });

  const ticket = await SupportRepo.getTicketById(ticketId);
  if (!ticket) throw Object.assign(new Error('Ticket not found'), { status: 404 });

  // Verify ownership or admin
  const isAdmin = await checkIsAdmin(clerkId);
  if (!isAdmin) {
    const isOwner = (ticket.userId === actor.id) || (ticket.guestEmail === actor.email);
    if (!isOwner) throw Object.assign(new Error('Forbidden'), { status: 403 });
  }

  const attachment = await SupportRepo.insertAttachment({
    ticketId,
    messageId: messageId || null,
    uploadedByUserId: actor.id,
    uploadedByRole: isAdmin ? 'admin' : 'user',
    originalName: metadata.originalName,
    mimeType: metadata.mimeType,
    size: metadata.size,
    storageKey: metadata.storageKey,
    url: metadata.url,
  });

  await SupportRepo.insertEvent({
    ticketId, actorId: actor.id, actorRole: isAdmin ? 'admin' : 'user',
    eventType: 'ATTACHMENT_ADDED', metadata: { filename: metadata.originalName, size: metadata.size },
  });

  await SupportRepo.updateTicket(ticketId, { updatedAt: new Date() });

  return attachment;
}

// ── Delegate Getters ──────────────────────────────────────────────────────────
export const getTickets = (filters) => SupportRepo.getTickets(filters);
export const getMyTickets = (userId, opts) => SupportRepo.getMyTickets(userId, opts);
export const getTicketById = (id) => SupportRepo.getTicketById(id);
export const getTicketMessages = (id, opts) => SupportRepo.getTicketMessages(id, opts);
export const getTicketEvents = (id) => SupportRepo.getTicketEvents(id);
export const getTeams = () => SupportRepo.getAllTeams();
export const getTags = () => SupportRepo.getAllTags();
export const getTicketCounts = (agentId) => SupportRepo.getTicketCounts(agentId);
export const getAdminUsers = () => SupportRepo.getAdminUsers();
export const createTeam = (data) => SupportRepo.insertTeam(data);
export const createTag = (data) => SupportRepo.insertTag(data);
export const deleteTag = (id) => SupportRepo.deleteTag(id);

export async function getAgentPresence() {
  const agents = await SupportRepo.getAdminUsers();
  const onlineClerkIds = supportSse.getOnlineClerkIds();
  return agents.map(agent => ({
    id: agent.id,
    name: agent.name,
    email: agent.email,
    profileImage: agent.profileImage,
    isOnline: onlineClerkIds.includes(agent.clerkId)
  }));
}

export async function getPerformanceAnalytics() {
  return await SupportRepo.getPerformanceMetrics();
}

// ── Helpers ───────────────────────────────────────────────────────────────────
export async function checkIsAdmin(clerkId) {
  try {
    const { resolveEffectivePermissions } = await import('../../middleware/rbac.js');
    const perms = await resolveEffectivePermissions(clerkId);
    return perms && perms.role;
  } catch {
    return false;
  }
}

function formatStatus(status) {
  return status?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || status;
}

async function sendTicketCreationEmails(ticket, name, email, subject, message) {
  try {
    await transporter.sendMail({
      from: `"Devid Aura Support" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: `Ticket Received: ${ticket.ticketNumber}`,
      text: `Hi ${name || 'there'},\n\nWe received your message regarding "${subject}".\nTicket Number: ${ticket.ticketNumber}\n\nWe will get back to you shortly.\n\n- Team Devid Aura`,
    });
    await transporter.sendMail({
      from: `"Devid Aura System" <${process.env.EMAIL_USER}>`,
      to: process.env.EMAIL_USER,
      subject: `New Ticket (${ticket.ticketNumber}) from ${name || email}`,
      text: `Subject: ${subject}\nFrom: ${email}\nPriority: ${ticket.priority}\nCategory: ${ticket.category || 'uncategorized'}\n\nMessage:\n${message}`,
    });
  } catch (err) {
    console.error('⚠️ Email sending failed:', err.message);
  }
}

async function sendReplyNotification(ticket, actor, messageText, senderRole) {
  try {
    const isUserReplying = senderRole === 'user';
    const targetEmail = isUserReplying ? process.env.EMAIL_USER : ticket.guestEmail;
    if (targetEmail) {
      await transporter.sendMail({
        from: `"Devid Aura Support" <${process.env.EMAIL_USER}>`,
        to: targetEmail,
        subject: isUserReplying
          ? `New Reply on Ticket ${ticket.ticketNumber}`
          : `Update on your Support Ticket ${ticket.ticketNumber}`,
        text: isUserReplying
          ? `User has replied to ticket ${ticket.ticketNumber}:\n\n"${messageText}"`
          : `Support has replied:\n\n"${messageText}"`,
      });
    }
  } catch (err) {
    console.error('⚠️ Reply notification failed:', err.message);
  }
}

// ── Canned Responses Service ──────────────────────────────────────────────────
export async function getCannedResponses() {
  return await SupportRepo.getCannedResponses();
}

export async function createCannedResponse(data) {
  return await SupportRepo.insertCannedResponse(data);
}

export async function seedCannedResponsesDefault() {
  try {
    const existing = await SupportRepo.getCannedResponses();
    if (existing.length > 0) return;

    const defaults = [
      {
        shortcut: '/greet',
        title: 'Standard Greeting',
        content: 'Hello! Thank you for contacting Devid Aura Support. My name is {{agentName}}. How may I assist you today?'
      },
      {
        shortcut: '/refund',
        title: 'Refund Processed',
        content: 'We have successfully processed a refund for your order. The funds should appear in your account within 3 to 5 business days, depending on your bank.'
      },
      {
        shortcut: '/track',
        title: 'Order Tracking',
        content: 'You can check the live shipping status of your package by going to your Devid Aura dashboard, selecting "My Orders", and clicking the tracking link.'
      },
      {
        shortcut: '/close',
        title: 'Closing Inactivity',
        content: 'Since we have not received a reply from you in a while, we will go ahead and mark this ticket as resolved. If you still require help, feel free to reply directly to reopen it. Have a wonderful day!'
      }
    ];

    for (const d of defaults) {
      await SupportRepo.insertCannedResponse(d);
    }
    console.log('✅ [Support] Successfully seeded default canned response templates.');
  } catch (err) {
    console.error('⚠️ [Support] Failed to seed canned responses:', err.message);
  }
}

// Auto-seed canned responses on boot
setTimeout(() => {
  seedCannedResponsesDefault().catch(err => console.error(err));
}, 3000);
