// src/modules/support/support.sse.js
// Native SSE stream manager for real-time support ticket events

import { db } from '../../db/client.js';
import { getRedisConfig } from '../../config/redis.js';
import Redis from 'ioredis';

// Redis Pub/Sub for distributed SSE
const config = getRedisConfig();
const pubClient = new Redis(config.url, config.options);
const subClient = new Redis(config.url, config.options);

const SSE_CHANNEL = 'support_sse_events';

subClient.subscribe(SSE_CHANNEL, (err, count) => {
  if (err) console.error('❌ [SSE] Failed to subscribe to Redis channel:', err);
  else console.log(`🔌 [SSE] Subscribed to ${SSE_CHANNEL} (${count} total channels)`);
});

subClient.on('message', (channel, message) => {
  if (channel !== SSE_CHANNEL) return;
  try {
    const { target, clerkId, eventPayload } = JSON.parse(message);
    if (target === 'user') {
      const clients = activeClients.get(clerkId);
      if (clients && clients.length > 0) {
        for (const client of clients) {
          client.res.write(`event: support_update\ndata: ${JSON.stringify(eventPayload)}\n\n`);
        }
      }
    } else if (target === 'admin') {
      for (const clients of activeClients.values()) {
        const adminClients = clients.filter(c => c.role === 'admin' || c.role === 'super_admin');
        for (const client of adminClients) {
          client.res.write(`event: support_update\ndata: ${JSON.stringify(eventPayload)}\n\n`);
        }
      }
    }
  } catch (err) {
    console.error('❌ [SSE] Error processing pub/sub message:', err);
  }
});

// Memory store for active client response objects
// Map of clerkId -> array of client connections: { res, role }
const activeClients = new Map();

export function addSseClient(clerkId, role, res) {
  if (!activeClients.has(clerkId)) {
    activeClients.set(clerkId, []);
  }

  const client = { res, role };
  activeClients.get(clerkId).push(client);

  console.log(`🔌 [SSE] Client connected: ${clerkId} (${role}). Total connected users: ${activeClients.size}`);

  // Send initial connection OK event
  res.write(`event: connected\ndata: ${JSON.stringify({ status: 'ok', role })}\n\n`);
}

export function removeSseClient(clerkId, res) {
  if (!activeClients.has(clerkId)) return;

  const clients = activeClients.get(clerkId);
  const updated = clients.filter(c => c.res !== res);

  if (updated.length === 0) {
    activeClients.delete(clerkId);
    cleanAgentViewers(clerkId);
  } else {
    activeClients.set(clerkId, updated);
  }

  console.log(`🔌 [SSE] Client disconnected: ${clerkId}. Active connections remaining for user: ${updated.length}`);
}

/**
 * Broadcasts support events (like message updates or status changes) to a specific user.
 * @param {string} userId - Database UUID of the customer
 * @param {object} eventPayload - Event data to stream
 */
export async function broadcastToUser(userId, eventPayload) {
  try {
    // Resolve user's Clerk ID from database users table
    const { usersTable } = await import('../../db/schema/index.js');
    const { eq } = await import('drizzle-orm');
    
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!user || !user.clerkId) return;

    // Publish to Redis instead of local write
    pubClient.publish(SSE_CHANNEL, JSON.stringify({
      target: 'user',
      clerkId: user.clerkId,
      eventPayload
    }));
  } catch (err) {
    console.error('⚠️ [SSE] Broadcast to user failed:', err);
  }
}

/**
 * Broadcasts support events to all active admin/agent connections.
 * @param {object} eventPayload - Event data to stream
 */
export function broadcastToAdmins(eventPayload) {
  pubClient.publish(SSE_CHANNEL, JSON.stringify({
    target: 'admin',
    eventPayload
  }));
}

// ── Connection Liveness Heartbeat ──────────────────────────────────────────────
// Send keep-alive comments every 20 seconds to prevent connection closure by proxies/gateways
setInterval(() => {
  let count = 0;
  for (const [clerkId, clients] of activeClients.entries()) {
    for (const client of clients) {
      client.res.write(`:keep-alive\n\n`);
      count++;
    }
  }
  if (count > 0) {
    console.log(`💓 [SSE] Sent heartbeat to ${count} active connections.`);
  }
}, 20000);

export function getOnlineClerkIds() {
  return Array.from(activeClients.keys());
}

// Map of ticketId -> Map of clerkId -> { clerkId, name, profileImage }
const activeTicketViewers = new Map();

export function addTicketViewer(ticketId, clerkId, user) {
  if (!activeTicketViewers.has(ticketId)) {
    activeTicketViewers.set(ticketId, new Map());
  }
  const viewers = activeTicketViewers.get(ticketId);
  viewers.set(clerkId, {
    clerkId,
    name: user.name,
    profileImage: user.profileImage
  });
  
  console.log(`👁️ [SSE] Agent ${user.name} viewing ticket ${ticketId}. Total viewers: ${viewers.size}`);
  
  broadcastToAdmins({
    event: 'support_update', // Use support_update with nested typing/collision event payloads
    event_type: 'ticket_viewers',
    ticketId,
    viewers: Array.from(viewers.values())
  });
}

export function removeTicketViewer(ticketId, clerkId) {
  if (!activeTicketViewers.has(ticketId)) return;
  const viewers = activeTicketViewers.get(ticketId);
  if (viewers.delete(clerkId)) {
    console.log(`👁️ [SSE] Agent ${clerkId} stopped viewing ticket ${ticketId}. Viewers remaining: ${viewers.size}`);
    
    if (viewers.size === 0) {
      activeTicketViewers.delete(ticketId);
    }
    
    broadcastToAdmins({
      event: 'support_update',
      event_type: 'ticket_viewers',
      ticketId,
      viewers: Array.from(viewers.values())
    });
  }
}

export function cleanAgentViewers(clerkId) {
  for (const [ticketId, viewers] of activeTicketViewers.entries()) {
    if (viewers.has(clerkId)) {
      viewers.delete(clerkId);
      console.log(`👁️ [SSE] Disconnect auto-cleanup: Agent ${clerkId} removed from ticket ${ticketId}`);
      
      if (viewers.size === 0) {
        activeTicketViewers.delete(ticketId);
      }
      
      broadcastToAdmins({
        event: 'support_update',
        event_type: 'ticket_viewers',
        ticketId,
        viewers: Array.from(viewers.values())
      });
    }
  }
}
