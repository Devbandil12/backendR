// src/infrastructure/shipping/providers/shiprocket.js
// Moved from: infrastructure/shipping/providers/shiprocket.js

import fetch from 'node-fetch';

const SHIPROCKET_BASE_URL = process.env.SHIPROCKET_BASE_URL || 'https://apiv2.shiprocket.in';

let authToken = null;
let authTokenExpiresAt = 0;

async function login() {
  const email = process.env.SHIPROCKET_EMAIL;
  const password = process.env.SHIPROCKET_PASSWORD;

  if (!email || !password) {
    throw new Error(
      'Shiprocket credentials are not configured. Please set SHIPROCKET_EMAIL and SHIPROCKET_PASSWORD in environment.'
    );
  }

  const res = await fetch(`${SHIPROCKET_BASE_URL}/v1/external/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Shiprocket auth failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  if (!data.token) throw new Error('Shiprocket auth response did not include a token.');

  authToken = data.token;
  authTokenExpiresAt = Date.now() + 9 * 24 * 60 * 60 * 1000; // 9 days
  return authToken;
}

async function getAuthToken() {
  if (authToken && Date.now() < authTokenExpiresAt) return authToken;
  return login();
}

async function shiprocketRequest(path, { method = 'GET', headers = {}, body } = {}) {
  const token = await getAuthToken();
  const url = path.startsWith('http')
    ? path
    : `${SHIPROCKET_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;

  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text().catch(() => '');

  if (!res.ok) {
    let errorPayload;
    try { errorPayload = text ? JSON.parse(text) : null; } catch { errorPayload = text || null; }
    const err = new Error(
      `Shiprocket API error: ${res.status} ${res.statusText}` +
        (errorPayload ? ` - ${JSON.stringify(errorPayload)}` : '')
    );
    err.status = res.status;
    err.payload = errorPayload;
    throw err;
  }

  try { return text ? JSON.parse(text) : {}; } catch { return text; }
}

export async function createOrder(orderPayload) {
  return shiprocketRequest('/v1/external/orders/create/adhoc', { method: 'POST', body: orderPayload });
}

export async function cancelOrder(orderIds) {
  const idsArray = Array.isArray(orderIds) ? orderIds : [orderIds];
  return shiprocketRequest('/v1/external/orders/cancel', { method: 'POST', body: { ids: idsArray } });
}

export async function createReturnOrder(returnPayload) {
  return shiprocketRequest('/v1/external/orders/create/return', { method: 'POST', body: returnPayload });
}

export async function trackByAwb(awbCode) {
  return shiprocketRequest(`/v1/external/courier/track/awb/${encodeURIComponent(awbCode)}`);
}

export async function trackByShipment(shipmentId) {
  return shiprocketRequest(`/v1/external/courier/track/shipment/${encodeURIComponent(shipmentId)}`);
}

export async function getServiceability(params) {
  const queryString = new URLSearchParams(params).toString();
  return shiprocketRequest(`/v1/external/courier/serviceability/?${queryString}`);
}

export async function assignAwb({ shipment_id, courier_id = null }) {
  const body = { shipment_id };
  if (courier_id) body.courier_id = courier_id;
  return shiprocketRequest('/v1/external/courier/assign/awb', { method: 'POST', body });
}

export async function getPickupLocations() {
  return shiprocketRequest('/v1/external/settings/company/pickup');
}

export const ShiprocketService = {
  createOrder, cancelOrder, createReturnOrder,
  trackByAwb, trackByShipment, getServiceability,
  getPickupLocations, assignAwb,
};
