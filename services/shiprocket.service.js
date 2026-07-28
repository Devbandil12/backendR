import fetch from 'node-fetch';

const SHIPROCKET_BASE_URL = process.env.SHIPROCKET_BASE_URL || 'https://apiv2.shiprocket.in';

let authToken = null;
let authTokenExpiresAt = 0;

async function login() {
  const email = process.env.SHIPROCKET_EMAIL;
  const password = process.env.SHIPROCKET_PASSWORD;

  if (!email || !password) {
    throw new Error('Shiprocket credentials are not configured. Please set SHIPROCKET_EMAIL and SHIPROCKET_PASSWORD in environment.');
  }

  const res = await fetch(`${SHIPROCKET_BASE_URL}/v1/external/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Shiprocket auth failed: ${res.status} ${text}`);
  }

  const data = await res.json();

  if (!data.token) {
    throw new Error('Shiprocket auth response did not include a token.');
  }

  authToken = data.token;
  // Shiprocket tokens are valid for 240 hours (~10 days). We set a conservative 9 days.
  const now = Date.now();
  const nineDaysMs = 9 * 24 * 60 * 60 * 1000;
  authTokenExpiresAt = now + nineDaysMs;

  return authToken;
}

async function getAuthToken() {
  if (authToken && Date.now() < authTokenExpiresAt) {
    return authToken;
  }
  return login();
}

async function shiprocketRequest(path, { method = 'GET', headers = {}, body } = {}) {
  const token = await getAuthToken();

  const url = path.startsWith('http')
    ? path
    : `${SHIPROCKET_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': body ? 'application/json' : 'application/json',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text().catch(() => '');

  if (!res.ok) {
    let errorPayload;
    try {
      errorPayload = text ? JSON.parse(text) : null;
    } catch {
      errorPayload = text || null;
    }

    const err = new Error(
      `Shiprocket API error: ${res.status} ${res.statusText}` +
        (errorPayload ? ` - ${JSON.stringify(errorPayload)}` : '')
    );
    err.status = res.status;
    err.payload = errorPayload;
    throw err;
  }

  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return text;
  }
}

export async function createOrder(orderPayload) {
  // orderPayload should conform to Shiprocket "Create Order" schema.
  return shiprocketRequest('/v1/external/orders/create/adhoc', {
    method: 'POST',
    body: orderPayload,
  });
}

export async function cancelOrder(orderId) {
  // orderId is Shiprocket order_id
  return shiprocketRequest('/v1/external/orders/cancel', {
    method: 'POST',
    body: { ids: [orderId] },
  });
}

// ✅ NEW: Added Return Order (Reverse Pickup) Logic
export async function createReturnOrder(returnPayload) {
  return shiprocketRequest('/v1/external/orders/create/return', {
    method: 'POST',
    body: returnPayload,
  });
}

export async function trackByAwb(awbCode) {
  return shiprocketRequest(`/v1/external/courier/track/awb/${encodeURIComponent(awbCode)}`, {
    method: 'GET',
  });
}

export async function trackByShipment(shipmentId) {
  return shiprocketRequest(
    `/v1/external/courier/track/shipment/${encodeURIComponent(shipmentId)}`,
    {
      method: 'GET',
    }
  );
}

export async function getServiceability(payload) {
  // payload should include pickup_postcode, delivery_postcode, cod, weight, etc.
  return shiprocketRequest('/v1/external/courier/serviceability/', {
    method: 'POST',
    body: payload,
  });
}

export async function getPickupLocations() {
  return shiprocketRequest('/v1/external/settings/company/pickup', {
    method: 'GET',
  });
}

export const ShiprocketService = {
  createOrder,
  cancelOrder,
  createReturnOrder, // ✅ NEW: Exported the return function
  trackByAwb,
  trackByShipment,
  getServiceability,
  getPickupLocations,
};