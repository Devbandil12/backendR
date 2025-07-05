// configs/index.js

import 'dotenv/config'; // ✅ Load environment variables first
import { neon } from '@neondatabase/serverless'; // ✅ Neon HTTP driver
import { drizzle } from 'drizzle-orm/neon-http'; // ✅ Drizzle for Neon HTTP
import * as schema from './schema.js'; // ✅ Your Drizzle schema

// ✅ Use DATABASE_URL from environment
const sql = neon(process.env.DATABASE_URL);

export const db = drizzle(sql, { schema });

console.log("✅ Connected to Neon via HTTP using drizzle-orm");
