import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { isPlatformRegistryMigrationAuthorized } from '../src/platformRegistryMigrationPolicy';

const adminConnectionString = process.env.DATABASE_ADMIN_URL;
const registryConnectionString = process.env.SUPERADMIN_DATABASE_URL;
const ssl = process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined;
const applyRequested = process.argv.includes('--apply');
const ledgerTable = 'public.platform_registry_schema_migrations';
const migrations = [
  'migrations/000_tenant_registry.sql',
  'migrations/001_platform_accounts_subscriptions.sql',
  'migrations/002_platform_content_and_messages.sql',
  'migrations/003_platform_retention_policies.sql',
  'migrations/004_management_access_and_encrypted_tokens.sql',
];

if (!adminConnectionString || !registryConnectionString) {
  throw new Error('DATABASE_ADMIN_URL and SUPERADMIN_DATABASE_URL are required');
}

function getRegistryAdminConnectionString(): string {
  const admin = new URL(adminConnectionString!);
  const registry = new URL(registryConnectionString!);

  // Use the privileged connection, but force it to the exact database used by
  // the application's registry connection. Never migrate the default postgres DB by accident.
  if (admin.hostname !== registry.hostname || admin.port !== registry.port) {
    throw new Error('DATABASE_ADMIN_URL and SUPERADMIN_DATABASE_URL must target the same PostgreSQL host and port');
  }
  admin.pathname = registry.pathname;
  return admin.toString();
}

const TRANSIENT_DB_CODES = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH',
  '57P03', '08001', '08006',
]);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function connectWithRetry(): Promise<pg.Client> {
  const connectionString = getRegistryAdminConnectionString();
  for (let attempt = 1; attempt <= 12; attempt++) {
    const db = new pg.Client({
      connectionString,
      connectionTimeoutMillis: 5000,
      ssl,
    });
    try {
      await db.connect();
      return db;
    } catch (error) {
      await db.end().catch(() => {});
      const code = (error as { code?: string }).code;
      if (!code || !TRANSIENT_DB_CODES.has(code) || attempt === 12) throw error;
      const delayMs = Math.min(1000 * attempt, 5000);
      console.warn(`Registry PostgreSQL is not ready (attempt ${attempt}/12); retrying in ${delayMs}ms.`);
      await sleep(delayMs);
    }
  }
  throw new Error('Registry PostgreSQL did not become available');
}

async function assertRegistryPrerequisites(db: pg.Client): Promise<void> {
  const tables = await db.query(
    `SELECT to_regclass('public.businesses') AS businesses,
            to_regclass('public.access_tokens') AS access_tokens`,
  );
  if (!tables.rows[0]?.businesses || !tables.rows[0]?.access_tokens) {
    throw new Error('Registry preflight failed: expected public.businesses and public.access_tokens tables were not found.');
  }

  const roles = await db.query(
    'SELECT rolname FROM pg_roles WHERE rolname = ANY($1::text[])',
    [['app_runtime', 'app_superadmin']],
  );
  const found = new Set(roles.rows.map((row: { rolname: string }) => row.rolname));
  for (const required of ['app_runtime', 'app_superadmin']) {
    if (!found.has(required)) {
      throw new Error(`Registry preflight failed: required PostgreSQL role ${required} does not exist.`);
    }
  }
}

async function getPendingMigrations(db: pg.Client): Promise<string[]> {
  const ledger = await db.query(`SELECT to_regclass('${ledgerTable}') AS table_name`);
  if (!ledger.rows[0]?.table_name) return migrations;

  const applied = await db.query(`SELECT version FROM ${ledgerTable}`);
  const appliedVersions = new Set(applied.rows.map((row: { version: string }) => row.version));
  return migrations.filter((migration) => !appliedVersions.has(migration));
}

async function main(): Promise<void> {
  const db = await connectWithRetry();
  let lockAcquired = false;
  try {
    await db.query('SELECT pg_advisory_lock($1, $2)', [74121, 93001]);
    lockAcquired = true;

    await assertRegistryPrerequisites(db);
    const pending = await getPendingMigrations(db);
    if (!pending.length) {
      console.log('Registry schema is up to date. No migration is required; no database changes were made.');
      return;
    }

    console.log(`Pending central registry migration(s): ${pending.join(', ')}`);
    if (!applyRequested) {
      console.log('Dry run only: no changes were made. Use the manual Platform registry migrations workflow to apply pending migrations.');
      return;
    }

    const backupConfirmed = process.env.PLATFORM_REGISTRY_MIGRATION_BACKUP_CONFIRMED === 'true';
    const authorized = isPlatformRegistryMigrationAuthorized({
      backupConfirmed,
      githubEventName: process.env.GITHUB_EVENT_NAME,
      proceedWithoutBackup: process.env.PROCEED_WITHOUT_BACKUP,
    });
    if (!authorized) {
      throw new Error(
        'Migration blocked. Verify a restorable Registry backup, or manually dispatch the Platform registry migrations workflow and explicitly approve proceeding without a backup.',
      );
    }

    if (!backupConfirmed) {
      console.warn('WARNING: an explicit one-time no-backup approval was provided for this manual workflow run.');
    }

    await db.query(`
      CREATE TABLE IF NOT EXISTS ${ledgerTable} (
        version text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    for (const migration of pending) {
      console.log(`Applying central registry migration: ${migration}`);
      const sql = readFileSync(join(process.cwd(), migration), 'utf8');
      // Each migration owns its BEGIN/COMMIT. If the process stops after the
      // migration commits but before the ledger insert, the idempotent SQL can
      // safely be retried on the next explicitly approved run.
      await db.query(sql);
      await db.query(
        `INSERT INTO ${ledgerTable} (version) VALUES ($1) ON CONFLICT (version) DO NOTHING`,
        [migration],
      );
      console.log(`Recorded central registry migration: ${migration}`);
    }

    console.log('All pending central registry migrations completed successfully.');
  } finally {
    if (lockAcquired) {
      await db.query('SELECT pg_advisory_unlock($1, $2)', [74121, 93001]).catch(() => {});
    }
    await db.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
