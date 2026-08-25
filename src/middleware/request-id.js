// src/middleware/request-id.js
// Attaches a unique X-Request-ID header to every request for tracing.

import crypto from 'crypto';

export const requestId = (req, res, next) => {
  const id = req.headers['x-request-id'] || crypto.randomUUID();
  req.requestId = id;
  res.setHeader('X-Request-ID', id);
  next();
};
