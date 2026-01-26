// ✅ file: middleware/errorHandler.js
import { logger } from '../services/logger.js';

export const errorHandler = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  // 1. Log the Error (The most important part!)
  logger.error(err.message, {
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userId: req.auth?.userId || 'guest',
    stack: err.stack,
    body: req.body // Be careful with PII (passwords) here in real production
  });

  // 2. Send Response
  if (process.env.NODE_ENV === 'development') {
    // In Dev: Send full details for debugging
    res.status(err.statusCode).json({
      status: err.status,
      error: err,
      message: err.message,
      stack: err.stack,
    });
  } else {
    // In Prod: Don't leak code details to hackers
    if (err.isOperational) {
      // Trusted error: Send message to client
      res.status(err.statusCode).json({
        status: err.status,
        message: err.message,
      });
    } else {
      // Programming or other unknown error: Don't leak details
      console.error('ERROR 💥', err); // Hard log for devops
      res.status(500).json({
        status: 'error',
        message: 'Something went very wrong!',
      });
    }
  }
};