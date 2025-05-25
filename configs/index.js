import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from "./schema.js"

const sql = neon(process.env.DB_URL);
export const db = drizzle({ client: sql },schema);
console.log("hello")
// const result = await db.execute('select 1');
