// scratch/final-audit.js
import 'dotenv/config';
import pkg from 'pg';

const { Pool } = pkg;

const devUrl = process.env.DEVELOPMENT_DATABASE_URL;
const prodUrl = process.env.PRODUCTION_DATABASE_URL;

if (!devUrl || !prodUrl) {
  console.error('Missing DEVELOPMENT_DATABASE_URL or PRODUCTION_DATABASE_URL');
  process.exit(1);
}

const devPool = new Pool({ connectionString: devUrl });
const prodPool = new Pool({ connectionString: prodUrl });

async function getFullMetadata(client) {
  // 1. Base Tables
  const tablesRes = await client.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE' 
      AND table_name NOT IN ('__drizzle_migrations')
    ORDER BY table_name;
  `);
  const tables = tablesRes.rows.map(r => r.table_name);

  // 2. Columns
  const colsRes = await client.query(`
    SELECT table_name, column_name, ordinal_position, column_default, is_nullable, data_type, udt_name, character_maximum_length
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name NOT IN ('__drizzle_migrations')
    ORDER BY table_name, column_name;
  `);

  // 3. Primary Keys
  const pkRes = await client.query(`
    SELECT tc.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public'
    ORDER BY tc.table_name, kcu.column_name;
  `);

  // 4. Unique Constraints
  const uqRes = await client.query(`
    SELECT tc.table_name, kcu.column_name, tc.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    WHERE tc.constraint_type = 'UNIQUE' AND tc.table_schema = 'public'
    ORDER BY tc.table_name, tc.constraint_name, kcu.column_name;
  `);

  // 5. Foreign Keys with ON DELETE and ON UPDATE
  const fkRes = await client.query(`
    SELECT
      tc.table_name AS source_table,
      kcu.column_name AS source_column,
      ccu.table_name AS target_table,
      ccu.column_name AS target_column,
      rc.delete_rule,
      rc.update_rule
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
    JOIN information_schema.referential_constraints rc
      ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
    ORDER BY tc.table_name, kcu.column_name, ccu.table_name, ccu.column_name;
  `);

  // 6. Check Constraints
  const chkRes = await client.query(`
    SELECT tc.table_name, cc.check_clause
    FROM information_schema.table_constraints tc
    JOIN information_schema.check_constraints cc
      ON tc.constraint_name = cc.constraint_name AND tc.table_schema = cc.constraint_schema
    WHERE tc.constraint_type = 'CHECK' AND tc.table_schema = 'public' AND tc.constraint_name NOT LIKE '%_not_null'
    ORDER BY tc.table_name, cc.check_clause;
  `);

  // 7. Indexes
  const idxRes = await client.query(`
    SELECT
      tablename,
      indexname,
      indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
    ORDER BY tablename, indexname;
  `);

  return {
    tables,
    columns: colsRes.rows,
    primaryKeys: pkRes.rows,
    uniqueConstraints: uqRes.rows,
    foreignKeys: fkRes.rows,
    checkConstraints: chkRes.rows,
    indexes: idxRes.rows,
  };
}

async function runAudit() {
  const devClient = await devPool.connect();
  const prodClient = await prodPool.connect();

  try {
    const dev = await getFullMetadata(devClient);
    const prod = await getFullMetadata(prodClient);

    console.log('=== 1. TABLES COMPARISON ===');
    console.log(`Dev Table Count: ${dev.tables.length}`);
    console.log(`Prod Table Count: ${prod.tables.length}`);

    const missingTables = dev.tables.filter(t => !prod.tables.includes(t));
    const extraTables = prod.tables.filter(t => !dev.tables.includes(t));
    console.log(`Missing in Prod: ${missingTables.length}`, missingTables);
    console.log(`Extra in Prod: ${extraTables.length}`, extraTables);

    console.log('\n=== 2. COLUMNS COMPARISON ===');
    const devColsMap = {};
    for (const c of dev.columns) {
      devColsMap[`${c.table_name}.${c.column_name}`] = c;
    }
    const prodColsMap = {};
    for (const c of prod.columns) {
      prodColsMap[`${c.table_name}.${c.column_name}`] = c;
    }

    const missingCols = [];
    const extraCols = [];
    const typeMismatches = [];
    const nullableMismatches = [];
    const defaultMismatches = [];

    for (const [key, d] of Object.entries(devColsMap)) {
      const p = prodColsMap[key];
      if (!p) {
        missingCols.push(key);
      } else {
        if (d.udt_name !== p.udt_name) {
          typeMismatches.push({ col: key, dev: d.udt_name, prod: p.udt_name });
        }
        if (d.is_nullable !== p.is_nullable) {
          nullableMismatches.push({ col: key, dev: d.is_nullable, prod: p.is_nullable });
        }
        // Normalize defaults (e.g., whitespace / casting differences)
        const dDef = (d.column_default || '').trim();
        const pDef = (p.column_default || '').trim();
        if (dDef !== pDef) {
          defaultMismatches.push({ col: key, dev: dDef, prod: pDef });
        }
      }
    }

    for (const key of Object.keys(prodColsMap)) {
      if (!devColsMap[key]) {
        extraCols.push(key);
      }
    }

    console.log(`Missing Columns: ${missingCols.length}`, missingCols);
    console.log(`Extra Columns: ${extraCols.length}`, extraCols);
    console.log(`Type Mismatches: ${typeMismatches.length}`, typeMismatches);
    console.log(`Nullable Mismatches: ${nullableMismatches.length}`, nullableMismatches);
    console.log(`Default Mismatches: ${defaultMismatches.length}`, defaultMismatches);

    console.log('\n=== 3. CONSTRAINTS COMPARISON ===');
    // PKs
    const devPKs = dev.primaryKeys.map(p => `${p.table_name}.${p.column_name}`).sort();
    const prodPKs = prod.primaryKeys.map(p => `${p.table_name}.${p.column_name}`).sort();
    const missingPKs = devPKs.filter(p => !prodPKs.includes(p));
    const extraPKs = prodPKs.filter(p => !devPKs.includes(p));
    console.log(`Missing PKs: ${missingPKs.length}`, missingPKs);
    console.log(`Extra PKs: ${extraPKs.length}`, extraPKs);

    // Unique Constraints
    const devUQs = dev.uniqueConstraints.map(u => `${u.table_name}.${u.column_name}`).sort();
    const prodUQs = prod.uniqueConstraints.map(u => `${u.table_name}.${u.column_name}`).sort();
    const missingUQs = devUQs.filter(u => !prodUQs.includes(u));
    const extraUQs = prodUQs.filter(u => !devUQs.includes(u));
    console.log(`Missing UQs: ${missingUQs.length}`, missingUQs);
    console.log(`Extra UQs: ${extraUQs.length}`, extraUQs);

    // Foreign Keys
    const devFKs = dev.foreignKeys.map(f => `${f.source_table}.${f.source_column} -> ${f.target_table}.${f.target_column} (DEL:${f.delete_rule}, UPD:${f.update_rule})`).sort();
    const prodFKs = prod.foreignKeys.map(f => `${f.source_table}.${f.source_column} -> ${f.target_table}.${f.target_column} (DEL:${f.delete_rule}, UPD:${f.update_rule})`).sort();
    const missingFKs = devFKs.filter(f => !prodFKs.includes(f));
    const extraFKs = prodFKs.filter(f => !devFKs.includes(f));
    console.log(`Missing FKs: ${missingFKs.length}`, missingFKs);
    console.log(`Extra FKs: ${extraFKs.length}`, extraFKs);

    // Check Constraints
    const devChks = dev.checkConstraints.map(c => `${c.table_name}: ${c.check_clause}`).sort();
    const prodChks = prod.checkConstraints.map(c => `${c.table_name}: ${c.check_clause}`).sort();
    const missingChks = devChks.filter(c => !prodChks.includes(c));
    const extraChks = prodChks.filter(c => !devChks.includes(c));
    console.log(`Missing Check Constraints: ${missingChks.length}`, missingChks);
    console.log(`Extra Check Constraints: ${extraChks.length}`, extraChks);

    console.log('\n=== 4. INDEXES COMPARISON ===');
    const devIndexes = dev.indexes.map(i => `${i.tablename}: ${i.indexname}`).sort();
    const prodIndexes = prod.indexes.map(i => `${i.tablename}: ${i.indexname}`).sort();
    const missingIdx = devIndexes.filter(i => !prodIndexes.includes(i));
    const extraIdx = prodIndexes.filter(i => !devIndexes.includes(i));
    console.log(`Missing Indexes: ${missingIdx.length}`, missingIdx);
    console.log(`Extra Indexes: ${extraIdx.length}`, extraIdx);

    console.log('\n=== 5. SPECIFIC REQUIRED CHECKS ===');
    // Check specific columns
    const specificCols = [
      'orders.fulfillment_status',
      'orders.return_status',
      'orders.version',
      'tickets.id',
      'ticket_messages.ticket_id',
      'ticket_events.ticket_id',
      'ticket_attachments.ticket_id',
      'support_csat.ticket_id'
    ];
    for (const sc of specificCols) {
      console.log(`${sc}: Dev=${devColsMap[sc]?.udt_name} (${devColsMap[sc]?.is_nullable}) | Prod=${prodColsMap[sc]?.udt_name} (${prodColsMap[sc]?.is_nullable})`);
    }

    console.log('\n=== 6. CLEANUP VERIFICATION (Must be NOT FOUND in Prod) ===');
    const cleanupCheck = [
      'users.role',
      'orders.refund_id',
      'orders.refund_amount',
      'orders.refund_status',
      'orders.refund_speed',
      'orders.refund_initiated_at',
      'orders.refund_completed_at'
    ];
    for (const c of cleanupCheck) {
      console.log(`${c} in Prod:`, prodColsMap[c] ? 'EXISTS (FAIL)' : 'NOT FOUND (PASSED)');
    }
    console.log(`activity_logs table in Prod:`, prod.tables.includes('activity_logs') ? 'EXISTS (FAIL)' : 'NOT FOUND (PASSED)');

    console.log('\n=== 7. RBAC DATA VERIFICATION ===');
    const prodRolesRes = await prodClient.query(`SELECT id, name FROM roles;`);
    console.log(`Prod Roles:`, prodRolesRes.rows);

    const prodUserRolesRes = await prodClient.query(`
      SELECT u.id, u.email, u.name, r.name as role_name, ur.assigned_at
      FROM users u
      LEFT JOIN user_roles ur ON ur.user_id = u.id
      LEFT JOIN roles r ON r.id = ur.role_id
      WHERE u.email IN ('omkarkaurav41@gmail.com', 'devbandil120@gmail.com', 'harshjadon6969@gmail.com');
    `);
    console.log('Prod Key Users RBAC state:');
    console.table(prodUserRolesRes.rows);

  } finally {
    devClient.release();
    prodClient.release();
    await devPool.end();
    await prodPool.end();
  }
}

runAudit().catch(console.error);
