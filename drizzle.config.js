import { defineConfig } from "drizzle-kit";


export default defineConfig({
  dialect: "postgresql",
  schema: "./configs/schema.js",
 dbCredentials:{
    url:'postgresql://neondb_owner:npg_TxdunH1Br8WU@ep-winter-bonus-a5nf4zu8-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require'
 }
})
