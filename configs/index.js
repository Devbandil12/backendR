// configs/index.js

import 'dotenv/config';
import { neon } from '@neondatabase/serverless'; // still using neon, but with postgresql://
import { drizzle } from 'drizzle-orm/neon-serverless'; // drizzle adapter for postgres URLs
import * as schema from './schema.js'; // your Drizzle schema

const sql = neon(process.env.DATABASE_URL); // expects postgresql:// URL

export const db = drizzle(sql, { schema });

console.log("✅ Connected to Neon via PostgreSQL (drizzle-orm + neon-serverless)");
