// helpers/safeCompare.js
//
// 🟢 FIX (low-priority hardening item): webhook/payment signature checks
// were using plain `!==`, which short-circuits on the first differing byte.
// For a security-critical signature comparison that's a timing side-channel
// — a patient attacker can, in principle, use response-time differences to
// guess the correct signature one byte at a time. crypto.timingSafeEqual
// compares in constant time regardless of where the strings first differ.
//
// timingSafeEqual throws if the two buffers aren't the same length, so this
// wrapper checks length first (a length mismatch is not a meaningful signal
// to hide — the real secret material never differs by length in a way that
// helps an attacker) and only calls timingSafeEqual once lengths match.

import crypto from 'crypto';

export function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;

  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);

  if (bufA.length !== bufB.length) return false;

  return crypto.timingSafeEqual(bufA, bufB);
}
