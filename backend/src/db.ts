import pg from 'pg';
import { env } from './config';
import { HttpError } from './errors';

// The central database is the tenant registry only. Tenant data must never
// fall back to this pool when a dedicated database mapping is missing.
export const pool = new pg.Pool({
  connectionString: env.APP_DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 5_000,
  ssl: env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

pool.on('error', (err) => console.error('pg registry pool error', err));

const TRANSIENT_CONNECTION_CODES = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH',
  'EAI_AGAIN', '57P03', '08001', '08006',
]);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function retryTransientConnection<T>(operation: () => Promise<T>, label: string): Promise<T> {
  const maxAttempts = 6;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await operation();
      if (attempt > 1) console.info('PostgreSQL connection recovered for ' + label + ' after ' + attempt + ' attempts.');
      return result;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (!code || !TRANSIENT_CONNECTION_CODES.has(code) || attempt === maxAttempts) {
        console.error('PostgreSQL connection failed for ' + label + ' (attempt ' + attempt + '/' + maxAttempts + '; code ' + (code ?? 'unknown') + ').');
        throw error;
      }
      const delayMs = Math.min(250 * (2 ** (attempt - 1)), 3000);
      console.warn('PostgreSQL is not ready for ' + label + ' (attempt ' + attempt + '/' + maxAttempts + '; code ' + code + '); retrying in ' + delayMs + 'ms.');
      await sleep(delayMs);
    }
  }
  throw new Error('PostgreSQL connection did not become available for ' + label + '.');
}

export function connectRegistryWithRetry(): Promise<pg.PoolClient> {
  return retryTransientConnection(() => pool.connect(), 'registry database connection');
}

export function queryRegistryWithRetry(queryText: string, values: any[] = []) {
  return retryTransientConnection(() => pool.query(queryText, values), 'registry database query');
}

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
    const result = await retryTransientConnection(
      () => pool.query('SELECT database_name FROM app.tenant_databases WHERE tenant_id = $1', [tenantId]),
      'tenant registry lookup',
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
  const expectedDatabaseName = `biz_${tenantId.replace(/-/g, '').slice(0, 24)}`;
  if (databaseName !== expectedDatabaseName) {
    // Do not trust a syntactically valid mapping if it points to another tenant's DB.
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

export async function closeTenantPools(): Promise<void> {
  await Promise.all([...tenantPools.values()].map((tenantPool) => tenantPool.end()));
  tenantPools.clear();
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
  // A sleeping PostgreSQL service can accept a pool connection before it is
  // ready to execute the first statement. Retry transaction initialization,
  // but never replay the caller's transaction after its callback has started.
  const client = await retryTransientConnection(async () => {
    const connectedClient = await selectedPool.connect();
    try {
      await connectedClient.query('BEGIN');
      await connectedClient.query(
        "SELECT set_config('app.current_tenant', $1, true), set_config('statement_timeout', '5000', true)",
        [tenantId],
      );
      return connectedClient;
    } catch (error) {
      // Destroy a connection whose transaction setup failed; it may be in an
      // aborted or uncertain transaction state and must not return to the pool.
      connectedClient.release(true);
      throw error;
    }
  }, 'tenant transaction initialization');
  try {
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
