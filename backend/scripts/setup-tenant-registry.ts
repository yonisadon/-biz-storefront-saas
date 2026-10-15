import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const connectionString = process.env.DATABASE_ADMIN_URL;
if (!connectionString) {
  throw new Error('DATABASE_ADMIN_URL is required');
}

const TRANSIENT_DB_CODES = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH',
  '57P03', '08001', '08006',
]);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function connectWithRetry(): Promise<pg.Client> {
  const maxAttempts = 12;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const db = new pg.Client({
      connectionString,
      connectionTimeoutMillis: 5000,
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    });

    try {
      await db.connect();
      return db;
    } catch (err) {
      await db.end().catch(() => {});
      const code = (err as { code?: string }).code;
      if (!code || !TRANSIENT_DB_CODES.has(code) || attempt === maxAttempts) throw err;

      const delayMs = Math.min(1000 * attempt, 5000);
      console.warn(`PostgreSQL is not ready (attempt ${attempt}/${maxAttempts}); retrying in ${delayMs}ms.`);
      await sleep(delayMs);
    }
  }

  throw new Error('PostgreSQL did not become available');
}

async function main() {
  // The database may be sleeping when Railway starts this service. Retry the
  // connection so a normal cold start does not prevent the API from starting.
  const db = await connectWithRetry();
  try {
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
