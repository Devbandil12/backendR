import { db } from '../../db/client.js';
import { auditLogsTable } from '../../db/schema/audit.schema.js';
import { and, eq, desc, lt, gte, lte } from 'drizzle-orm';
import { usersTable } from '../../db/schema/users.schema.js';
import { userRolesTable, rolesTable } from '../../db/schema/index.js';

/**
 * Inserts a single audit log into the database.
 * If provided a transaction (tx), it uses it, otherwise it uses the global db.
 */
export const insertAuditLog = async (logData, tx = null) => {
  const connection = tx || db;
  const result = await connection.insert(auditLogsTable).values(logData).returning();
  return result[0];
};

/**
 * Retrieves audit logs with cursor-based pagination and filtering.
 */
export const getAuditLogs = async (filters, cursor, limit = 50) => {
  const conditions = [];

  if (filters.actorUserId) conditions.push(eq(auditLogsTable.actorUserId, filters.actorUserId));
  if (filters.category) conditions.push(eq(auditLogsTable.category, filters.category));
  if (filters.action) conditions.push(eq(auditLogsTable.action, filters.action));
  if (filters.resourceId) conditions.push(eq(auditLogsTable.resourceId, filters.resourceId));
  if (filters.resourceType) conditions.push(eq(auditLogsTable.resourceType, filters.resourceType));
  if (filters.status) conditions.push(eq(auditLogsTable.status, filters.status));
  if (filters.severity) conditions.push(eq(auditLogsTable.severity, filters.severity));
  
  if (filters.startDate) conditions.push(gte(auditLogsTable.createdAt, new Date(filters.startDate)));
  if (filters.endDate) conditions.push(lte(auditLogsTable.createdAt, new Date(filters.endDate)));

  if (cursor) {
    conditions.push(lt(auditLogsTable.createdAt, new Date(cursor)));
  }

  const query = db.select({
    id: auditLogsTable.id,
    actorUserId: auditLogsTable.actorUserId,
    actorType: auditLogsTable.actorType,
    action: auditLogsTable.action,
    category: auditLogsTable.category,
    severity: auditLogsTable.severity,
    resourceType: auditLogsTable.resourceType,
    resourceId: auditLogsTable.resourceId,
    resourceDisplayName: auditLogsTable.resourceDisplayName,
    resourceDisplaySubtitle: auditLogsTable.resourceDisplaySubtitle,
    description: auditLogsTable.description,
    status: auditLogsTable.status,
    createdAt: auditLogsTable.createdAt,
    ipAddress: auditLogsTable.ipAddress,
    actorName: usersTable.name,
    actorEmail: usersTable.email,
    actorRole: rolesTable.name,
  })
  .from(auditLogsTable)
  .leftJoin(usersTable, eq(auditLogsTable.actorUserId, usersTable.id))
  .leftJoin(userRolesTable, eq(usersTable.id, userRolesTable.userId))
  .leftJoin(rolesTable, eq(userRolesTable.roleId, rolesTable.id))
  .where(conditions.length > 0 ? and(...conditions) : undefined)
  .orderBy(desc(auditLogsTable.createdAt))
  .limit(limit);

  const results = await query;
  return results;
};
