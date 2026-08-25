import pkg from 'uuid';
const { v4: uuidv4 } = pkg;
import { db } from '../../db/client.js';
import { outboxTable } from '../../db/schema/outbox.schema.js';
import { insertAuditLog } from './audit.repository.js';
import { getRequestContext } from '../context/requestContext.js';
import { sanitizePayload } from './audit.sanitizer.js';
import { AUDIT_EVENTS } from './audit.events.js';
import { AUDIT_STATUS, ACTOR_TYPES } from './audit.constants.js';
import { formatResourceDisplay } from './audit.resource-display.js';

/**
 * Generates the full audit record from business inputs and request context.
 */
const buildAuditRecord = (payload) => {
  const context = getRequestContext();
  const eventMeta = AUDIT_EVENTS[payload.action];
  
  if (!eventMeta) {
    console.warn(`[AUDIT WARNING] Unknown audit action: ${payload.action}`);
  }

  const category = eventMeta?.category || 'SYSTEM';
  const severity = eventMeta?.severity || 'INFO';
  
  const before = payload.before ? sanitizePayload(payload.before) : null;
  const after = payload.after ? sanitizePayload(payload.after) : null;
  const changes = payload.changes ? sanitizePayload(payload.changes) : null;
  const metadata = payload.metadata ? sanitizePayload(payload.metadata) : null;

  let { resourceDisplayName, resourceDisplaySubtitle } = payload;
  
  if (payload.resourceData && !resourceDisplayName) {
    const formatted = formatResourceDisplay(payload.resourceType, payload.resourceData);
    resourceDisplayName = formatted.resourceDisplayName;
    resourceDisplaySubtitle = formatted.resourceDisplaySubtitle;
  }

  return {
    actorUserId: payload.actorUserId || null,
    actorType: payload.actorType || ACTOR_TYPES.SYSTEM,
    actorRole: payload.actorRole || null,
    action: payload.action,
    category,
    severity,
    resourceType: payload.resourceType || null,
    resourceId: payload.resourceId ? String(payload.resourceId) : null,
    resourceDisplayName: resourceDisplayName || null,
    resourceDisplaySubtitle: resourceDisplaySubtitle || null,
    description: payload.description || null,
    before,
    after,
    changes,
    metadata,
    requestId: context.requestId,
    ipAddress: context.ip,
    userAgent: context.userAgent,
    status: payload.status || AUDIT_STATUS.SUCCESS,
    failureReason: payload.failureReason ? String(payload.failureReason) : null,
  };
};

/**
 * Logs an audit event securely.
 * 
 * If `tx` is provided and event is critical, it writes synchronously to the DB within the transaction.
 * Otherwise, it leverages the outbox pattern or background insert to prevent blocking business logic.
 * 
 * @param {Object} payload 
 * @param {Object} [tx] Drizzle transaction instance
 */
export const log = async (payload, tx = null) => {
  try {
    const record = buildAuditRecord(payload);
    const eventMeta = AUDIT_EVENTS[payload.action];
    
    const isCritical = eventMeta?.critical === true;

    if (tx) {
      if (isCritical) {
        // Critical mutations: logged synchronously inside the same DB transaction.
        await insertAuditLog(record, tx);
      } else {
        // Non-blocking event within a transaction -> Outbox
        await tx.insert(outboxTable).values({
          id: uuidv4(),
          eventType: 'AUDIT_LOG',
          payload: record,
        });
      }
    } else {
      // No transaction provided. Log directly but don't block.
      // For actual production, a message queue or background job is better,
      // but for MVP outbox / direct async insert works.
      insertAuditLog(record, db).catch(err => {
        console.error('[AUDIT ERROR] Background audit insert failed:', err);
      });
    }
  } catch (err) {
    console.error('[AUDIT ERROR] Failed to construct or save audit log:', err);
    // We intentionally swallow the error so business logic isn't interrupted by audit failure,
    // unless it was part of a transaction which would roll back.
    if (tx) throw err; 
  }
};

export const audit = {
  log
};
