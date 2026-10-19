import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type pg from 'pg';

type DbClient = pg.Client | pg.PoolClient;

const MIGRATION_FILE = /^tenant-\d{3}[-_][a-z0-9_-]+\.sql$/i;

/**
 * Applies numbered, additive tenant-schema migrations exactly once per database.
 * The caller must use a privileged connection to the selected tenant database.
 */
export async function applyTenantMigrations(
  db: DbClient,
  migrationsDir = join(process.cwd(), 'migrations'),
): Promise<string[]> {
  const files = readdirSync(migrationsDir)
    .filter((file) => MIGRATION_FILE.test(file))
    .sort();

  await db.query(`
    CREATE TABLE IF NOT EXISTS public.tenant_schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const applied: string[] = [];
  for (const file of files) {
    const already = await db.query(
      'SELECT 1 FROM public.tenant_schema_migrations WHERE version = $1',
      [file],
    );
    if (already.rowCount) continue;

    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    await db.query('BEGIN');
    try {
      // Migration SQL must contain only transactional DDL/DML; no BEGIN/COMMIT.
      await db.query(sql);
      await db.query(
        'INSERT INTO public.tenant_schema_migrations (version) VALUES ($1)',
        [file],
      );
      await db.query('COMMIT');
      applied.push(file);
    } catch (error) {
      await db.query('ROLLBACK').catch(() => {});
      throw new Error(`Tenant migration ${file} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return applied;
}
