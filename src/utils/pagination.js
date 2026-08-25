// src/utils/pagination.js
// Standard pagination helper.

/**
 * parsePagination(query)
 * Returns { page, limit, offset } from req.query.
 */
export function parsePagination(query = {}, defaults = { page: 1, limit: 20 }) {
  const page = Math.max(1, parseInt(query.page) || defaults.page);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit) || defaults.limit));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

/**
 * paginatedResponse(data, total, page, limit)
 * Returns a consistent paginated envelope.
 */
export function paginatedResponse(data, total, page, limit) {
  return {
    data,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasNext: page * limit < total,
      hasPrev: page > 1,
    },
  };
}
