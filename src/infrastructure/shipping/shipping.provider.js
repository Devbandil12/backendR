// src/infrastructure/shipping/shipping.provider.js
// Thin wrapper that delegates to the active provider.
// Swap providers here without touching business logic.

import * as shiprocket from './providers/shiprocket.js';

export const shippingProvider = shiprocket;
