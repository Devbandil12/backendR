// src/middleware/error-handler.js
// Moved from: middleware/error-handler.js
import { logger } from '../observability/logger.js';

export const errorHandler = (err, req, res, next) => {
  if (err.message === 'Unauthenticated') {
    err.statusCode = 401;
    err.status = 'error';
    err.isOperational = true;
  }
  
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  logger.error(err.message, {
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userId: req.auth?.userId || 'guest',
    stack: err.stack,
  });

  if (process.env.NODE_ENV === 'development') {
    return res.status(err.statusCode).json({
      status: err.status,
      error: err,
      message: err.message,
      stack: err.stack,
    });
  }

  if (err.isOperational) {
    return res.status(err.statusCode).json({ status: err.status, message: err.message });
  }

  console.error('ERROR 💥', err);
  res.status(500).json({ status: 'error', message: 'Something went very wrong!' });
};
