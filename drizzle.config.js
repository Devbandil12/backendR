import { defineConfig } from "drizzle-kit";
import 'dotenv/config';

export default defineConfig({
  dialect: "postgresql",
  schema: "./configs/schema.js",
  dbCredentials: {
    url: process.env.DATABASE_URL, 
  },
});
