import pg from 'pg';
import { env } from './config';

export const pool = new pg.Pool({
  connectionString: env.APP_DATABASE_URL,
  max: 10,
  ssl: env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

pool.on('error', (err) => console.error('pg pool error', err));

/**
 * Runs fn inside a transaction with app.current_tenant bound LOCALLY
 * (set_config(..., true)), so the value dies at COMMIT/ROLLBACK and can
 * never leak to another request through the pool.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (db: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
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
