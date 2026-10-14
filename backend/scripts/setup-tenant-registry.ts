import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const connectionString = process.env.DATABASE_ADMIN_URL;
if (!connectionString) {
  throw new Error('DATABASE_ADMIN_URL is required');
}

async function main() {
  const db = new pg.Client({
    connectionString,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });
  try {
    await db.connect();
    const sql = readFileSync(join(__dirname, '../migrations/000_tenant_registry.sql'), 'utf8');
    await db.query(sql);
    console.log('Tenant database registry migration applied successfully.');
  } finally {
    await db.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
