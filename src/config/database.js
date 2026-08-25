// src/config/database.js
// Re-exports the Drizzle db client from the db layer.
// Import `db` from here in config-level code; modules should import from src/db/client.js directly.
export { db } from '../db/client.js';
