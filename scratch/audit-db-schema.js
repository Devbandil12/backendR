// scratch/audit-db-schema.js
import 'dotenv/config';
import pkg from 'pg';
import { is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import * as schema from '../src/db/schema/index.js';

const { Pool } = pkg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function auditDatabase() {
  console.log('🔍 Starting Database ↔ Drizzle Schema Audit...\n');
  const client = await pool.connect();

  try {
    // 1. Fetch all live tables from PostgreSQL
    const tablesRes = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `);
    const liveTables = tablesRes.rows.map(r => r.table_name);

    // 2. Fetch all columns
    const columnsRes = await client.query(`
      SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position;
    `);

    const liveColumnsByTable = {};
    for (const col of columnsRes.rows) {
      if (!liveColumnsByTable[col.table_name]) {
        liveColumnsByTable[col.table_name] = {};
      }
      liveColumnsByTable[col.table_name][col.column_name] = {
        dataType: col.data_type,
        udtName: col.udt_name,
        isNullable: col.is_nullable === 'YES',
        defaultVal: col.column_default,
      };
    }

    // 3. Fetch all foreign keys
    const fkRes = await client.query(`
      SELECT
          tc.table_name, 
          kcu.column_name, 
          ccu.table_name AS foreign_table_name,
          ccu.column_name AS foreign_column_name,
          rc.delete_rule,
          rc.update_rule
      FROM information_schema.table_constraints AS tc 
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      JOIN information_schema.referential_constraints AS rc
        ON tc.constraint_name = rc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema='public';
    `);

    // 4. Fetch all indexes
    const indexesRes = await client.query(`
      SELECT
          tablename,
          indexname,
          indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
      ORDER BY tablename, indexname;
    `);

    const liveIndexes = indexesRes.rows;

    // 5. Inspect Drizzle schema objects
    const drizzleTables = {};
    for (const [exportName, exportObj] of Object.entries(schema)) {
      try {
        if (is(exportObj, PgTable) || (exportObj && exportObj._ && exportObj._.name)) {
          const config = getTableConfig(exportObj);
          drizzleTables[config.name] = {
            exportName,
            config,
            columns: config.columns,
            indexes: config.indexes,
            foreignKeys: config.foreignKeys
          };
        }
      } catch (e) {
        // Not a pgTable export (e.g. helper, enum, relation, etc.)
      }
    }

    console.log(`📊 Found ${liveTables.length} live Postgres tables.`);
    console.log(`📊 Found ${Object.keys(drizzleTables).length} Drizzle exported tables: [${Object.keys(drizzleTables).join(', ')}]\n`);

    const mismatches = [];
    const warnings = [];

    // Check table existence
    for (const dTable of Object.keys(drizzleTables)) {
      if (!liveTables.includes(dTable)) {
        mismatches.push(`❌ Table Missing in Postgres: Drizzle defines '${dTable}' (${drizzleTables[dTable].exportName}), but missing in live DB.`);
      }
    }

    for (const lTable of liveTables) {
      if (!drizzleTables[lTable] && lTable !== '__drizzle_migrations') {
        warnings.push(`⚠️ Postgres table '${lTable}' is not exported as a Drizzle PgTable in schema/index.js.`);
      }
    }

    // Check column existence & types & nullability
    for (const [tableName, dTableInfo] of Object.entries(drizzleTables)) {
      if (!liveColumnsByTable[tableName]) continue;

      const liveCols = liveColumnsByTable[tableName];
      const dCols = dTableInfo.columns;

      for (const col of dCols) {
        const colName = col.name;
        if (!liveCols[colName]) {
          mismatches.push(`❌ Column Missing in Postgres: '${tableName}.${colName}' in Drizzle but missing in DB.`);
        } else {
          const liveCol = liveCols[colName];
          if (col.notNull && liveCol.isNullable) {
            warnings.push(`⚠️ Nullability: '${tableName}.${colName}' is NOT NULL in Drizzle, but NULLABLE in Postgres.`);
          }
        }
      }

      for (const liveColName of Object.keys(liveCols)) {
        const matchingDCol = dCols.find(c => c.name === liveColName);
        if (!matchingDCol) {
          warnings.push(`⚠️ Extra Column in DB: '${tableName}.${liveColName}' exists in Postgres but not in Drizzle '${tableName}' definition.`);
        }
      }
    }

    // Check for Legacy Refund Columns
    const legacyColumns = ['refund_id', 'refund_amount', 'refund_status', 'refund_speed', 'refund_initiated_at', 'refund_completed_at'];
    console.log('🔍 Checking for deprecated legacy refund columns in live tables...');
    for (const t of ['orders', 'returns', 'payments']) {
      if (liveColumnsByTable[t]) {
        for (const col of legacyColumns) {
          if (liveColumnsByTable[t][col]) {
            mismatches.push(`🚨 CRITICAL: Legacy column '${col}' still exists in live '${t}' table!`);
          }
        }
      }
    }

    console.log('\n================ AUDIT SUMMARY ================');
    if (mismatches.length === 0) {
      console.log('✅ DATABASE SCHEMA: 0 Critical Mismatches!');
    } else {
      console.log(`❌ Found ${mismatches.length} CRITICAL Database Mismatches:`);
      mismatches.forEach(m => console.log(`  ${m}`));
    }

    if (warnings.length > 0) {
      console.log(`\n⚠️ Found ${warnings.length} Schema Warnings / Info:`);
      warnings.forEach(w => console.log(`  ${w}`));
    }

    // Print critical tables status
    const criticalTables = [
      'orders', 'order_items', 'order_timeline', 'returns', 'return_items', 
      'refunds', 'order_notes', 'payments', 'coupons', 'coupon_redemptions', 
      'notifications', 'analytics_events', 'outbox', 'audit_logs', 'roles', 
      'permissions', 'role_permissions', 'user_roles', 'users', 'user_address'
    ];

    console.log('\n================ CRITICAL TABLES STATUS ================');
    for (const ct of criticalTables) {
      const inDb = liveTables.includes(ct);
      const inDrizzle = !!drizzleTables[ct];
      const colCount = liveColumnsByTable[ct] ? Object.keys(liveColumnsByTable[ct]).length : 0;
      console.log(`  ${inDb && inDrizzle ? '✅' : '❌'} ${ct.padEnd(20)}: DB=${inDb ? 'YES ('+colCount+' cols)' : 'NO'}, Drizzle=${inDrizzle ? 'YES' : 'NO'}`);
    }

  } catch (err) {
    console.error('Audit failed with error:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

auditDatabase();
