// src/middleware/validation.js
// Centralised request validation middleware.
// Pass a Zod / Joi schema and this validates req.body, returning 400 on failure.

export const validate = (schema) => (req, res, next) => {
  try {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ success: false, errors: result.error.errors });
    }
    req.body = result.data;
    next();
  } catch (err) {
    next(err);
  }
};
