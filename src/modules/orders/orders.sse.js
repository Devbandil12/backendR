// src/modules/orders/orders.sse.js
// Native SSE stream manager for real-time Order Command Center events

import { db } from '../../db/client.js';
import { getRedisConfig } from '../../config/redis.js';
import Redis from 'ioredis';

const config = getRedisConfig();
const pubClient = new Redis(config.url, config.options);
const subClient = new Redis(config.url, config.options);

const ORDERS_SSE_CHANNEL = 'orders_sse_events';

subClient.subscribe(ORDERS_SSE_CHANNEL, (err, count) => {
  if (err) console.error('❌ [Orders SSE] Failed to subscribe to Redis channel:', err);
  else console.log(`🔌 [Orders SSE] Subscribed to ${ORDERS_SSE_CHANNEL} (${count} total channels)`);
});

// Memory store for active client response objects: clerkId -> [{ res, role }]
const activeClients = new Map();

subClient.on('message', (channel, message) => {
  if (channel !== ORDERS_SSE_CHANNEL) return;
  try {
    const { target, clerkId, eventType, eventPayload } = JSON.parse(message);
    const sseMessage = `event: order_update\ndata: ${JSON.stringify({ eventType, ...eventPayload })}\n\n`;

    if (target === 'user' && clerkId) {
      const clients = activeClients.get(clerkId);
      if (clients && clients.length > 0) {
        for (const client of clients) {
          client.res.write(sseMessage);
        }
      }
    } else if (target === 'admin' || target === 'all') {
      for (const clients of activeClients.values()) {
        const targetClients = target === 'all' 
          ? clients 
          : clients.filter(c => c.role === 'admin' || c.role === 'super_admin');
        for (const client of targetClients) {
          client.res.write(sseMessage);
        }
      }
    }
  } catch (err) {
    console.error('❌ [Orders SSE] Error processing pub/sub message:', err);
  }
});

export function addOrderSseClient(clerkId, role, res) {
  if (!activeClients.has(clerkId)) {
    activeClients.set(clerkId, []);
  }

  const client = { res, role };
  activeClients.get(clerkId).push(client);

  console.log(`🔌 [Orders SSE] Client connected: ${clerkId} (${role}). Total active order listeners: ${activeClients.size}`);
  res.write(`event: connected\ndata: ${JSON.stringify({ status: 'ok', role, timestamp: new Date().toISOString() })}\n\n`);
}

export function removeOrderSseClient(clerkId, res) {
  if (!activeClients.has(clerkId)) return;

  const clients = activeClients.get(clerkId);
  const updated = clients.filter(c => c.res !== res);

  if (updated.length === 0) {
    activeClients.delete(clerkId);
  } else {
    activeClients.set(clerkId, updated);
  }

  console.log(`🔌 [Orders SSE] Client disconnected: ${clerkId}. Active connections remaining for user: ${updated.length}`);
}

/**
 * Broadcasts an order event to all admin consoles and optionally the order customer.
 * @param {string} eventType - e.g. ORDER_CREATED, ORDER_STATUS_CHANGED, PAYMENT_UPDATED, SHIPMENT_UPDATED, RETURN_UPDATED, REFUND_UPDATED
 * @param {object} payload - Event payload containing orderId, status, details, etc.
 * @param {string} [userId] - Optional database UUID of the customer to notify
 */
export async function broadcastOrderEvent(eventType, payload, userId = null) {
  try {
    // 1. Broadcast to all admins
    pubClient.publish(ORDERS_SSE_CHANNEL, JSON.stringify({
      target: 'admin',
      eventType,
      eventPayload: payload
    }));

    // 2. If customer userId provided, broadcast to customer too
    if (userId) {
      const { usersTable } = await import('../../db/schema/index.js');
      const { eq } = await import('drizzle-orm');
      
      const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
      if (user && user.clerkId) {
        pubClient.publish(ORDERS_SSE_CHANNEL, JSON.stringify({
          target: 'user',
          clerkId: user.clerkId,
          eventType,
          eventPayload: payload
        }));
      }
    }
  } catch (err) {
    console.error('⚠️ [Orders SSE] Broadcast failed:', err);
  }
}

// ── Connection Liveness Heartbeat (Every 20s) ──────────────────────────────
setInterval(() => {
  let count = 0;
  for (const [, clients] of activeClients.entries()) {
    for (const client of clients) {
      client.res.write(`:keep-alive\n\n`);
      count++;
    }
  }
}, 20000);
