import * as AuditRepository from './audit.repository.js';
import { usersTable } from '../../db/schema/users.schema.js';
import { db } from '../../db/client.js';
import { eq, like, or } from 'drizzle-orm';

/**
 * Controller to fetch audit logs with filtering and cursor pagination.
 */
export const getAuditLogs = async (req, res) => {
  try {
    const {
      cursor,
      limit = 50,
      actorUserId,
      category,
      action,
      resourceId,
      resourceType,
      status,
      severity,
      startDate,
      endDate,
      search // Allows searching by actor email/name or resource ID
    } = req.query;

    const filters = {
      actorUserId,
      category,
      action,
      resourceId,
      resourceType,
      status,
      severity,
      startDate,
      endDate
    };

    // If search text is provided, we can either search by user or resource ID.
    // For simplicity, if search looks like a UUID, we can set it to resourceId, 
    // or we resolve users by email and filter by actorUserId.
    if (search && !filters.actorUserId && !filters.resourceId) {
      // Very basic search by email/name to get user ID
      const users = await db.select({ id: usersTable.id }).from(usersTable)
        .where(or(
          like(usersTable.email, `%${search}%`),
          like(usersTable.name, `%${search}%`)
        )).limit(10);
      
      if (users.length > 0) {
        // Just take the first match for simplicity in filtering
        filters.actorUserId = users[0].id;
      }
    }

    const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);

    const logs = await AuditRepository.getAuditLogs(filters, cursor, parsedLimit + 1);

    const hasMore = logs.length > parsedLimit;
    const paginatedLogs = hasMore ? logs.slice(0, parsedLimit) : logs;
    const nextCursor = hasMore ? paginatedLogs[paginatedLogs.length - 1].createdAt.toISOString() : null;

    return res.status(200).json({
      success: true,
      data: paginatedLogs,
      pagination: {
        nextCursor,
        hasMore
      }
    });

  } catch (error) {
    console.error('Error fetching audit logs:', error);
    return res.status(500).json({ success: false, error: 'Failed to retrieve audit logs' });
  }
};
