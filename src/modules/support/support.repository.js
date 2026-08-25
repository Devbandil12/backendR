// src/modules/support/support.repository.js
// Database layer for enterprise support system

import { db } from '../../db/client.js';
import {
  ticketsTable, ticketMessagesTable, ticketEventsTable,
  ticketAttachmentsTable, supportTeamsTable, supportTagsTable,
  ticketCounterTable, usersTable, supportCsatTable, supportCannedResponsesTable, outboxTable,
} from '../../db/schema/index.js';
import { eq, desc, asc, or, and, like, isNull, sql, ne, ilike, inArray } from 'drizzle-orm';

// ── Ticket Number Generation ──────────────────────────────────────────────────
export const generateTicketNumber = async () => {
  const year = new Date().getFullYear();

  return await db.transaction(async (tx) => {
    let result = await tx.execute(sql`
      UPDATE ticket_counter 
      SET last_number = last_number + 1 
      WHERE year = ${year} 
      RETURNING last_number
    `);
    
    let lastNumber = result.rows?.[0]?.last_number ?? result[0]?.last_number;
    
    if (!lastNumber) {
      result = await tx.execute(sql`
        INSERT INTO ticket_counter (year, last_number) 
        VALUES (${year}, 1) 
        RETURNING last_number
      `);
      lastNumber = result.rows?.[0]?.last_number ?? result[0]?.last_number ?? 1;
    }
    
    return `SUP-${year}-${String(lastNumber).padStart(6, '0')}`;
  });
};

// ── User Lookups ──────────────────────────────────────────────────────────────
export const getUserByClerkId = async (clerkId) => {
  const [user] = await db
    .select({ id: usersTable.id, email: usersTable.email, name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.clerkId, clerkId));
  return user;
};

export const getUserByClerkIdFull = async (clerkId) => {
  const user = await db.query.usersTable.findFirst({
    where: eq(usersTable.clerkId, clerkId),
  });
  return user;
};

export const getUserById = async (userId) => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  return user;
};

// ── Create Ticket ─────────────────────────────────────────────────────────────
export const createTicket = async (ticketData, firstMessage, eventData, outboxEventData, onlineAdmins = []) => {
  return await db.transaction(async (tx) => {
    
    // Auto-Assignment Engine (Atomic Load Balancing)
    let assignedAgentId = null;
    let assignedAgentName = null;

    if (onlineAdmins && onlineAdmins.length > 0) {
      const agentIds = onlineAdmins.map(a => a.id);
      
      // 1. Lock the eligible agent rows to serialize concurrent assignments
      await tx.select({ id: usersTable.id })
        .from(usersTable)
        .where(inArray(usersTable.id, agentIds))
        .for('update');

      // 2. Calculate active workload & tie-breaker
      const ticketLoads = await tx
        .select({
          agentId: ticketsTable.assignedAgentId,
          count: sql`count(*)`.mapWith(Number),
          lastAssignedAt: sql`MAX(${ticketsTable.createdAt})`
        })
        .from(ticketsTable)
        .where(
          and(
            inArray(ticketsTable.status, ['new', 'open', 'in_progress']),
            inArray(ticketsTable.assignedAgentId, agentIds)
          )
        )
        .groupBy(ticketsTable.assignedAgentId);

      const loadMap = {};
      const lastAssignedMap = {};
      ticketLoads.forEach(load => {
        loadMap[load.agentId] = load.count;
        lastAssignedMap[load.agentId] = load.lastAssignedAt ? new Date(load.lastAssignedAt).getTime() : 0;
      });

      let minLoad = Infinity;
      let oldestAssigned = Infinity;

      for (const admin of onlineAdmins) {
        const load = loadMap[admin.id] || 0;
        const lastAssigned = lastAssignedMap[admin.id] || 0;
        
        if (load < minLoad) {
          minLoad = load;
          oldestAssigned = lastAssigned;
          assignedAgentId = admin.id;
          assignedAgentName = admin.name;
        } else if (load === minLoad) {
          // Tie-breaker: least recently assigned
          if (lastAssigned < oldestAssigned) {
            oldestAssigned = lastAssigned;
            assignedAgentId = admin.id;
            assignedAgentName = admin.name;
          }
        }
      }
      
      if (assignedAgentId) {
        ticketData.assignedAgentId = assignedAgentId;
      }
    }

    const [ticket] = await tx.insert(ticketsTable).values(ticketData).returning();

    const [message] = await tx.insert(ticketMessagesTable).values({
      ticketId: ticket.id,
      ...firstMessage,
    }).returning();

    await tx.insert(ticketEventsTable).values({
      ticketId: ticket.id,
      ...eventData,
    });

    if (assignedAgentId) {
       await tx.insert(ticketEventsTable).values({
         ticketId: ticket.id,
         actorRole: 'system',
         eventType: 'ASSIGNED',
         toValue: assignedAgentId,
         metadata: { autoAssigned: true, strategy: 'LEAST_LOAD', agentLoad: loadMap?.[assignedAgentId] || 0 }
       });
       
       await tx.insert(ticketMessagesTable).values({
         ticketId: ticket.id,
         senderRole: 'system',
         messageType: 'system_event',
         message: `Auto-Assignment Engine: Ticket assigned to ${assignedAgentName} (Load Balanced)`
       });
    }

    if (outboxEventData) {
      await tx.insert(outboxTable).values(outboxEventData);
    }

    return { ticket, message };
  });
};

// ── Get Tickets (Admin — paginated, filtered) ─────────────────────────────────
export const getTickets = async ({
  status, priority, category, assignedAgentId, assignedTeamId,
  search, page = 1, limit = 30,
} = {}) => {
  const conditions = [isNull(ticketsTable.deletedAt)];

  if (status) conditions.push(eq(ticketsTable.status, status));
  if (priority) conditions.push(eq(ticketsTable.priority, priority));
  if (category) conditions.push(eq(ticketsTable.category, category));
  if (assignedAgentId === 'unassigned') {
    conditions.push(isNull(ticketsTable.assignedAgentId));
  } else if (assignedAgentId) {
    conditions.push(eq(ticketsTable.assignedAgentId, assignedAgentId));
  }
  if (assignedTeamId) conditions.push(eq(ticketsTable.assignedTeamId, assignedTeamId));

  if (search) {
    conditions.push(
      or(
        ilike(ticketsTable.ticketNumber, `%${search}%`),
        ilike(ticketsTable.subject, `%${search}%`),
        ilike(ticketsTable.guestEmail, `%${search}%`),
        ilike(ticketsTable.guestName, `%${search}%`),
        ilike(ticketsTable.relatedOrderId, `%${search}%`),
      )
    );
  }

  const where = conditions.length > 1 ? and(...conditions) : conditions[0];
  const offset = (page - 1) * limit;

  const [tickets, countResult] = await Promise.all([
    db.query.ticketsTable.findMany({
      where,
      with: {
        user: { columns: { id: true, name: true, email: true, profileImage: true, phone: true, walletBalance: true } },
        assignedAgent: { columns: { id: true, name: true, email: true, profileImage: true } },
        assignedTeam: true,
        messages: {
          orderBy: [desc(ticketMessagesTable.createdAt)],
          limit: 1, // Only latest message for preview
        },
      },
      orderBy: [desc(ticketsTable.updatedAt)],
      limit,
      offset,
    }),
    db.select({ count: sql`count(*)`.as('count') }).from(ticketsTable).where(where),
  ]);

  return {
    data: tickets,
    total: Number(countResult[0]?.count ?? 0),
    page,
    limit,
    totalPages: Math.ceil(Number(countResult[0]?.count ?? 0) / limit),
  };
};

// ── Get User's Own Tickets ────────────────────────────────────────────────────
export const getMyTickets = async (userId, { page = 1, limit = 20 } = {}) => {
  const where = and(
    eq(ticketsTable.userId, userId),
    isNull(ticketsTable.deletedAt),
  );
  const offset = (page - 1) * limit;

  const [tickets, countResult] = await Promise.all([
    db.query.ticketsTable.findMany({
      where,
      with: {
        messages: {
          where: ne(ticketMessagesTable.messageType, 'internal_note'),
          orderBy: [desc(ticketMessagesTable.createdAt)],
          limit: 1,
        },
        assignedAgent: { columns: { id: true, name: true } },
        assignedTeam: { columns: { id: true, name: true } },
      },
      orderBy: [desc(ticketsTable.updatedAt)],
      limit,
      offset,
    }),
    db.select({ count: sql`count(*)`.as('count') }).from(ticketsTable).where(where),
  ]);

  return {
    data: tickets,
    total: Number(countResult[0]?.count ?? 0),
    page,
    limit,
  };
};

// ── Get Single Ticket by ID ───────────────────────────────────────────────────
export const getTicketById = async (ticketId) => {
  return await db.query.ticketsTable.findFirst({
    where: eq(ticketsTable.id, ticketId),
    with: {
      user: { columns: { id: true, name: true, email: true, profileImage: true, phone: true, walletBalance: true, createdAt: true } },
      assignedAgent: { columns: { id: true, name: true, email: true, profileImage: true } },
      assignedTeam: true,
      attachments: { orderBy: [asc(ticketAttachmentsTable.createdAt)] },
      supportCsat: true,
    },
  });
};

// ── Find ticket by ticket number (human-readable) ─────────────────────────────
export const getTicketByNumber = async (ticketNumber) => {
  return await db.query.ticketsTable.findFirst({
    where: eq(ticketsTable.ticketNumber, ticketNumber),
  });
};

// ── Get Ticket Messages (paginated, cursor-based) ─────────────────────────────
export const getTicketMessages = async (ticketId, { limit = 50, before, includeInternal = false } = {}) => {
  const conditions = [eq(ticketMessagesTable.ticketId, ticketId)];

  if (!includeInternal) {
    conditions.push(ne(ticketMessagesTable.messageType, 'internal_note'));
  }

  if (before) {
    conditions.push(sql`${ticketMessagesTable.createdAt} < ${before}`);
  }

  const messages = await db.query.ticketMessagesTable.findMany({
    where: and(...conditions),
    with: {
      sender: { columns: { id: true, name: true, profileImage: true } },
      attachments: true,
    },
    orderBy: [desc(ticketMessagesTable.createdAt)],
    limit: limit + 1, // +1 to determine hasMore
  });

  const hasMore = messages.length > limit;
  if (hasMore) messages.pop();

  return {
    messages: messages.reverse(), // Return chronological order
    hasMore,
    nextCursor: hasMore ? messages[0]?.createdAt?.toISOString() : null,
  };
};

// ── Get Ticket Events ─────────────────────────────────────────────────────────
export const getTicketEvents = async (ticketId) => {
  return await db.query.ticketEventsTable.findMany({
    where: eq(ticketEventsTable.ticketId, ticketId),
    with: {
      actor: { columns: { id: true, name: true, profileImage: true } },
    },
    orderBy: [asc(ticketEventsTable.createdAt)],
  });
};

// ── Insert Message ────────────────────────────────────────────────────────────
export const insertMessage = async (data) => {
  const [message] = await db.insert(ticketMessagesTable).values(data).returning();
  return message;
};

// ── Transactional Reply (Includes Outbox) ─────────────────────────────────────
export const replyToTicket = async (ticketId, messageData, eventData, updateData, outboxEventData) => {
  return await db.transaction(async (tx) => {
    const [message] = await tx.insert(ticketMessagesTable).values(messageData).returning();

    await tx.insert(ticketEventsTable).values(eventData);

    await tx.update(ticketsTable)
      .set(updateData)
      .where(eq(ticketsTable.id, ticketId));

    if (outboxEventData) {
      await tx.insert(outboxTable).values(outboxEventData);
    }

    return message;
  });
};

// ── Insert Event ──────────────────────────────────────────────────────────────
export const insertEvent = async (data) => {
  const [event] = await db.insert(ticketEventsTable).values(data).returning();
  return event;
};

// ── Update Ticket ─────────────────────────────────────────────────────────────
export const updateTicket = async (ticketId, data) => {
  const [updated] = await db
    .update(ticketsTable)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(ticketsTable.id, ticketId))
    .returning();
  return updated;
};

// ── Insert Attachment ─────────────────────────────────────────────────────────
export const insertAttachment = async (data) => {
  const [attachment] = await db.insert(ticketAttachmentsTable).values(data).returning();
  return attachment;
};

// ── Teams ─────────────────────────────────────────────────────────────────────
export const getAllTeams = async () => {
  return await db.select().from(supportTeamsTable).orderBy(asc(supportTeamsTable.name));
};

export const insertTeam = async (data) => {
  const [team] = await db.insert(supportTeamsTable).values(data).returning();
  return team;
};

export const updateTeam = async (teamId, data) => {
  const [team] = await db.update(supportTeamsTable).set(data).where(eq(supportTeamsTable.id, teamId)).returning();
  return team;
};

// ── Tags ──────────────────────────────────────────────────────────────────────
export const getAllTags = async () => {
  return await db.select().from(supportTagsTable).orderBy(asc(supportTagsTable.name));
};

export const insertTag = async (data) => {
  const [tag] = await db.insert(supportTagsTable).values(data).returning();
  return tag;
};

export const deleteTag = async (tagId) => {
  await db.delete(supportTagsTable).where(eq(supportTagsTable.id, tagId));
};

// ── Admin Agent Listing (for assignment dropdowns) ────────────────────────────
export const getAdminUsers = async () => {
  // Get users who have any role assigned (i.e. admin panel users)
  const { userRolesTable } = await import('../../db/schema/rbac.schema.js');
  
  const admins = await db
    .selectDistinct({
      id: usersTable.id,
      clerkId: usersTable.clerkId,
      name: usersTable.name,
      email: usersTable.email,
      profileImage: usersTable.profileImage,
    })
    .from(usersTable)
    .innerJoin(userRolesTable, eq(userRolesTable.userId, usersTable.id));

  return admins;
};

// ── Ticket Counts (for sidebar badges) ────────────────────────────────────────
export const getTicketCounts = async (agentId) => {
  const baseCond = isNull(ticketsTable.deletedAt);

  const [
    allOpen,
    myTickets,
    unassigned,
    waitingForCustomer,
    resolved,
  ] = await Promise.all([
    db.select({ count: sql`count(*)` }).from(ticketsTable)
      .where(and(baseCond, inArray(ticketsTable.status, ['new', 'open', 'in_progress', 'pending']))),
    agentId
      ? db.select({ count: sql`count(*)` }).from(ticketsTable)
          .where(and(baseCond, eq(ticketsTable.assignedAgentId, agentId), ne(ticketsTable.status, 'closed'), ne(ticketsTable.status, 'resolved'), ne(ticketsTable.status, 'spam')))
      : [{ count: 0 }],
    db.select({ count: sql`count(*)` }).from(ticketsTable)
      .where(and(baseCond, isNull(ticketsTable.assignedAgentId), ne(ticketsTable.status, 'closed'), ne(ticketsTable.status, 'resolved'), ne(ticketsTable.status, 'spam'))),
    db.select({ count: sql`count(*)` }).from(ticketsTable)
      .where(and(baseCond, eq(ticketsTable.status, 'waiting_for_customer'))),
    db.select({ count: sql`count(*)` }).from(ticketsTable)
      .where(and(baseCond, eq(ticketsTable.status, 'resolved'))),
  ]);

  return {
    allOpen: Number(allOpen[0]?.count ?? 0),
    myTickets: Number(myTickets[0]?.count ?? 0),
    unassigned: Number(unassigned[0]?.count ?? 0),
    waitingForCustomer: Number(waitingForCustomer[0]?.count ?? 0),
    resolved: Number(resolved[0]?.count ?? 0),
  };
};

// ── CSAT Ratings ──────────────────────────────────────────────────────────────
export const insertCsatFeedback = async (data) => {
  const [csat] = await db.insert(supportCsatTable).values(data).returning();
  return csat;
};

// ── Agent Load Balancing (Atomic) ─────────────────────────────────────────────
export const getAgentTicketLoadAtomic = async (tx, agentIds) => {
  if (!agentIds || agentIds.length === 0) return [];

  // Lock the eligible agent rows to serialize concurrent assignments involving them
  await tx.select({ id: usersTable.id })
    .from(usersTable)
    .where(inArray(usersTable.id, agentIds))
    .for('update');

  // Calculate active workload & tie-breaker (lastAssignedAt)
  return await tx
    .select({
      agentId: ticketsTable.assignedAgentId,
      count: sql`count(*)`.mapWith(Number),
      lastAssignedAt: sql`MAX(${ticketsTable.createdAt})`
    })
    .from(ticketsTable)
    .where(
      and(
        inArray(ticketsTable.status, ['new', 'open', 'in_progress']),
        inArray(ticketsTable.assignedAgentId, agentIds)
      )
    )
    .groupBy(ticketsTable.assignedAgentId);
};

export const getCsatStats = async () => {
  const [overall] = await db
    .select({
      average: sql`ROUND(AVG(${supportCsatTable.rating})::numeric, 1)`,
      count: sql`COUNT(*)`
    })
    .from(supportCsatTable);
    
  const distribution = await db
    .select({
      rating: supportCsatTable.rating,
      count: sql`COUNT(*)`
    })
    .from(supportCsatTable)
    .groupBy(supportCsatTable.rating)
    .orderBy(desc(supportCsatTable.rating));
    
  const recentComments = await db
    .select({
      rating: supportCsatTable.rating,
      comment: supportCsatTable.comment,
      createdAt: supportCsatTable.createdAt,
      ticketId: supportCsatTable.ticketId
    })
    .from(supportCsatTable)
    .where(sql`${supportCsatTable.comment} IS NOT NULL AND ${supportCsatTable.comment} != ''`)
    .orderBy(desc(supportCsatTable.createdAt))
    .limit(10);
    
  return {
    average: Number(overall?.average ?? 0),
    count: Number(overall?.count ?? 0),
    distribution: distribution.map(d => ({ rating: Number(d.rating), count: Number(d.count) })),
    recentComments
  };
};

// ── Canned Responses ──────────────────────────────────────────────────────────
export const getCannedResponses = async (userId) => {
  return await db
    .select()
    .from(supportCannedResponsesTable)
    .where(
      and(
        eq(supportCannedResponsesTable.isActive, true),
        or(
          eq(supportCannedResponsesTable.scope, 'GLOBAL'),
          eq(supportCannedResponsesTable.createdBy, userId)
        )
      )
    )
    .orderBy(asc(supportCannedResponsesTable.shortcut));
};

export const getCannedResponseById = async (id) => {
  const [resp] = await db.select().from(supportCannedResponsesTable).where(eq(supportCannedResponsesTable.id, id));
  return resp;
};

export const insertCannedResponse = async (data) => {
  const [resp] = await db.insert(supportCannedResponsesTable).values(data).returning();
  return resp;
};

export const updateCannedResponse = async (id, data) => {
  const [resp] = await db.update(supportCannedResponsesTable)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(supportCannedResponsesTable.id, id))
    .returning();
  return resp;
};

export const deleteCannedResponse = async (id) => {
  await db.delete(supportCannedResponsesTable).where(eq(supportCannedResponsesTable.id, id));
};

// Helper to look up team by name (case-insensitive or simple match)
export const getTeamByName = async (name) => {
  const [team] = await db
    .select()
    .from(supportTeamsTable)
    .where(ilike(supportTeamsTable.name, name))
    .limit(1);
  return team;
};

export const getPerformanceMetrics = async () => {
  const [averages] = await db
    .select({
      avgFirstResponseMin: sql`ROUND(AVG(EXTRACT(EPOCH FROM (${ticketsTable.firstResponseAt} - ${ticketsTable.createdAt})) / 60)::numeric, 1)`,
      avgResolutionHour: sql`ROUND(AVG(EXTRACT(EPOCH FROM (${ticketsTable.resolvedAt} - ${ticketsTable.createdAt})) / 3600)::numeric, 1)`,
      totalTickets: sql`COUNT(*)`,
      totalResponded: sql`COUNT(*) FILTER (WHERE ${ticketsTable.firstResponseAt} IS NOT NULL)`,
      totalResolved: sql`COUNT(*) FILTER (WHERE ${ticketsTable.status} = 'resolved' OR ${ticketsTable.status} = 'closed')`,
      responseBreached: sql`COUNT(*) FILTER (WHERE ${ticketsTable.isFirstResponseBreached} = true)`,
      resolutionBreached: sql`COUNT(*) FILTER (WHERE ${ticketsTable.isResolutionBreached} = true)`,
    })
    .from(ticketsTable)
    .where(isNull(ticketsTable.deletedAt));

  const priorityBreakdown = await db
    .select({
      priority: ticketsTable.priority,
      count: sql`COUNT(*)`
    })
    .from(ticketsTable)
    .where(isNull(ticketsTable.deletedAt))
    .groupBy(ticketsTable.priority);

  const categoryBreakdown = await db
    .select({
      category: ticketsTable.category,
      count: sql`COUNT(*)`
    })
    .from(ticketsTable)
    .where(isNull(ticketsTable.deletedAt))
    .groupBy(ticketsTable.category);

  return {
    avgFirstResponseMin: Number(averages?.avgFirstResponseMin ?? 0),
    avgResolutionHour: Number(averages?.avgResolutionHour ?? 0),
    totalTickets: Number(averages?.totalTickets ?? 0),
    totalResponded: Number(averages?.totalResponded ?? 0),
    totalResolved: Number(averages?.totalResolved ?? 0),
    responseBreached: Number(averages?.responseBreached ?? 0),
    resolutionBreached: Number(averages?.resolutionBreached ?? 0),
    priorityBreakdown: priorityBreakdown.map(p => ({ priority: p.priority, count: Number(p.count) })),
    categoryBreakdown: categoryBreakdown.map(c => ({ category: c.category || 'uncategorized', count: Number(c.count) })),
  };
};
