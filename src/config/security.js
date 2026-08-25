// src/config/security.js
export const helmetOptions = {
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allow images to load cross-origin
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
  referrerPolicy: {
    policy: 'strict-origin-when-cross-origin',
  },
  xssFilter: true,
  noSniff: true,
  frameguard: {
    action: 'deny'
  }
};
