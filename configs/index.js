// db.ts or configs/index.js
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';
import 'dotenv/config';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Needed for Neon + Render
});

export const db = drizzle(pool, { schema });

console.log("Connected to PostgreSQL (Neon via pg)");
