// src/middleware/security.js
// Additional security middleware (beyond Helmet).
// Block source map access, etc.

export const blockSourceMaps = (req, res, next) => {
  if (req.path.endsWith('.map')) {
    return res.status(403).send('Source map access is forbidden.');
  }
  next();
};
