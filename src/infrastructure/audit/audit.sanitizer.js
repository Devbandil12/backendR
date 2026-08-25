const SENSITIVE_KEYS = [
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'secret',
  'apiKey',
  'otp',
  'otpHash',
  'authorization',
  'cookie',
  'paymentSecret',
  'clientSecret',
  'r2Secret',
  'razorpaySignature',
  'stripeSignature'
];

/**
 * Deep clones an object while stripping sensitive keys and truncating huge strings.
 */
export const sanitizePayload = (payload) => {
  if (payload === null || payload === undefined) {
    return payload;
  }

  if (Array.isArray(payload)) {
    return payload.map(sanitizePayload);
  }

  if (typeof payload === 'object') {
    const sanitized = {};
    for (const [key, value] of Object.entries(payload)) {
      if (SENSITIVE_KEYS.some((sensitive) => key.toLowerCase().includes(sensitive.toLowerCase()))) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = sanitizePayload(value);
      }
    }
    return sanitized;
  }

  if (typeof payload === 'string' && payload.length > 5000) {
    return payload.substring(0, 5000) + '... [TRUNCATED]';
  }

  return payload;
};
