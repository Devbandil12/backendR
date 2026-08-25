import 'dotenv/config';
import pkg from 'pg';

const { Pool } = pkg;

async function run() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query('TRUNCATE TABLE support_canned_responses CASCADE;');
    console.log('Truncated support_canned_responses successfully.');
  } catch (err) {
    console.error('Error truncating table:', err);
  } finally {
    await pool.end();
  }
}

run();
