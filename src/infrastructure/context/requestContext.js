import { AsyncLocalStorage } from 'async_hooks';

export const requestContext = new AsyncLocalStorage();

/**
 * Express middleware to inject request context for audit logging.
 */
export const requestContextMiddleware = (req, res, next) => {
  const context = {
    requestId: req.id || req.headers['x-request-id'] || null,
    ip: req.ip || req.connection?.remoteAddress || null,
    userAgent: req.headers['user-agent'] || null,
  };

  requestContext.run(context, () => {
    next();
  });
};

/**
 * Retrieves the current request context for the audit log.
 * @returns {{ requestId: string | null, ip: string | null, userAgent: string | null }}
 */
export const getRequestContext = () => {
  return requestContext.getStore() || { requestId: null, ip: null, userAgent: null };
};
