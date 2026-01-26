// ✅ file: services/logger.js
import winston from 'winston';
import path from 'path';

// Define log format
const logFormat = winston.format.printf(({ level, message, timestamp, ...meta }) => {
  return `${timestamp} [${level}]: ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
});

export const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }), // Log stack trace
    winston.format.json() // Structured JSON logs for production
  ),
  defaultMeta: { service: 'devid-aura-backend' },
  transports: [
    // 1. Write all errors to `error.log`
    new winston.transports.File({ 
        filename: path.join('logs', 'error.log'), 
        level: 'error' 
    }),
    // 2. Write all logs to `combined.log`
    new winston.transports.File({ 
        filename: path.join('logs', 'combined.log') 
    }),
  ],
});

// If we're not in production, log to the console with colors
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      logFormat
    ),
  }));
}