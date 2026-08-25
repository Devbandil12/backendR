// src/utils/safeCompare.js
// Moved from: utils/safeCompare.js
// Timing-safe string comparison — use for webhook signatures, OTP comparisons.

import crypto from 'crypto';

export function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;

  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);

  if (bufA.length !== bufB.length) return false;

  return crypto.timingSafeEqual(bufA, bufB);
}
