// src/infrastructure/cache/cache.serializer.js
// Custom serializers for non-JSON-safe values (Dates, BigInt, etc.).

export const serialize = (value) => JSON.stringify(value);

export const deserialize = (raw) => JSON.parse(raw);
