import pg from 'pg';
import { env } from './config';
import { HttpError } from './errors';

// The central database is the tenant registry only. Tenant data must never
// fall back to this pool when a dedicated database mapping is missing.
export const pool = new pg.Pool({
  connectionString: env.APP_DATABASE_URL,
  max: 10,
  ssl: env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

pool.on('error', (err) => console.error('pg registry pool error', err));

const tenantPools = new Map<string, pg.Pool>();

function connectionStringForDatabase(databaseName: string) {
  const url = new URL(env.APP_DATABASE_URL);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

/**
 * Resolves a tenant to its dedicated database. Missing mappings, a missing
 * registry table/schema, or an invalid database name are fatal: tenant data
 * must never be served from the central registry or another tenant database.
 */
async function poolForTenant(tenantId: string): Promise<pg.Pool> {
  let databaseName: string | undefined;
  try {
    const result = await pool.query(
      'SELECT database_name FROM app.tenant_databases WHERE tenant_id = $1',
      [tenantId],
    );
    databaseName = result.rows[0]?.database_name;
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === '42P01' || code === '3F000') {
      throw new HttpError(503, 'tenant_database_unavailable');
    }
    throw err;
  }

  if (!databaseName) {
    throw new HttpError(503, 'tenant_database_unavailable');
  }
  if (!/^biz_[a-f0-9]{24}$/.test(databaseName)) {
    throw new HttpError(503, 'tenant_database_unavailable');
  }

  const existing = tenantPools.get(databaseName);
  if (existing) return existing;

  const tenantPool = new pg.Pool({
    connectionString: connectionStringForDatabase(databaseName),
    max: 2,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl: env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });
  tenantPool.on('error', (err) => console.error('pg tenant pool error', err));
  tenantPools.set(databaseName, tenantPool);
  return tenantPool;
}

/**
 * Runs fn inside a transaction with app.current_tenant bound LOCALLY
 * (set_config(..., true)), so the value dies at COMMIT/ROLLBACK and can
 * never leak to another request through the pool.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (db: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const selectedPool = await poolForTenant(tenantId);
  const client = await selectedPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT set_config('app.current_tenant', $1, true), set_config('statement_timeout', '5000', true)",
      [tenantId],
    );
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}
