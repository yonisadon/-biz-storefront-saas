import pg from 'pg';
import { applyTenantMigrations } from '../src/tenantMigrations';

const adminUrl = process.env.DATABASE_ADMIN_URL;
const registryUrl = process.env.SUPERADMIN_DATABASE_URL;
const ssl = process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined;

if (!adminUrl || !registryUrl) {
  throw new Error('DATABASE_ADMIN_URL and SUPERADMIN_DATABASE_URL are required');
}

function databaseUrl(databaseName: string): string {
  const url = new URL(adminUrl!);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function expectedDatabaseName(tenantId: string): string {
  return `biz_${tenantId.replace(/-/g, '').slice(0, 24)}`;
}

const TRANSIENT_DB_CODES = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH',
  '57P03', '08001', '08006',
]);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function connect(connectionString: string, label: string): Promise<pg.Client> {
  const maxAttempts = 12;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const client = new pg.Client({
      connectionString,
      ssl,
      connectionTimeoutMillis: 5000,
    });

    try {
      await client.connect();
      if (attempt > 1) {
        console.log(`Connected to ${label} after ${attempt} attempts.`);
      }
      return client;
    } catch (err) {
      await client.end().catch(() => {});
      const code = (err as { code?: string }).code;
      if (!code || !TRANSIENT_DB_CODES.has(code) || attempt === maxAttempts) throw err;

      const delayMs = Math.min(1000 * attempt, 5000);
      console.warn(
        `PostgreSQL connection to ${label} is not ready (attempt ${attempt}/${maxAttempts}; code ${code}); retrying in ${delayMs}ms.`,
      );
      await sleep(delayMs);
    }
  }

  throw new Error(`PostgreSQL connection to ${label} did not become available.`);
}

async function main() {
  const registry = await connect(registryUrl!, 'tenant registry');
  try {
    const result = await registry.query(
      'SELECT tenant_id, database_name FROM app.tenant_databases ORDER BY tenant_id',
    );
    const tenants = result.rows as { tenant_id: string; database_name: string }[];

    if (!tenants.length) {
      console.log('No tenant databases are registered; nothing to migrate.');
      return;
    }

    // Preflight every mapped DB before changing any of them.
    for (const tenant of tenants) {
      if (tenant.database_name !== expectedDatabaseName(tenant.tenant_id)) {
        throw new Error(`Unexpected database mapping for tenant ${tenant.tenant_id}; stopped before applying migrations.`);
      }
      const db = await connect(databaseUrl(tenant.database_name), `tenant database ${tenant.database_name}`);
      try {
        const schema = await db.query(
          `SELECT to_regclass('public.businesses') AS businesses,
                  to_regclass('public.products') AS products,
                  to_regclass('public.leads') AS leads,
                  to_regclass('public.portfolio_images') AS portfolio_images`,
        );
        const row = schema.rows[0];
        if (!row.businesses || !row.products || !row.leads || !row.portfolio_images) {
          throw new Error(`Tenant database ${tenant.database_name} is missing expected core tables; stopped before applying migrations.`);
        }

        const tenantRow = await db.query('SELECT id FROM public.businesses WHERE id = $1', [tenant.tenant_id]);
        if (!tenantRow.rowCount) {
          throw new Error(`Tenant database ${tenant.database_name} does not contain its mapped business row; stopped before applying migrations.`);
        }

        const columnResult = await db.query(
          `SELECT table_name, column_name, data_type, udt_name
             FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name IN ('products', 'leads')`,
        );
        const columns = new Map(
          columnResult.rows.map((column) => [
            `${column.table_name}.${column.column_name}`,
            column,
          ]),
        );
        for (const required of ['leads.customer_name', 'leads.customer_phone']) {
          if (!columns.has(required)) {
            throw new Error(`Tenant database ${tenant.database_name} is missing required column ${required}; stopped before applying migrations.`);
          }
        }
        for (const [name, expectedType] of [
          ['products.requires_appointment', 'boolean'],
          ['products.appointment_duration_minutes', 'smallint'],
        ] as const) {
          const column = columns.get(name);
          if (column && column.data_type !== expectedType) {
            throw new Error(`Tenant database ${tenant.database_name} has unexpected type for ${name}; expected ${expectedType}, found ${column.data_type}. Stopped before applying migrations.`);
          }
        }

        const durationConstraint = await db.query(
          `SELECT pg_get_constraintdef(oid) AS definition
             FROM pg_constraint
            WHERE conrelid = 'public.products'::regclass
              AND conname = 'products_appointment_duration_minutes_check'`,
        );
        if (durationConstraint.rowCount) {
          const definition = String(durationConstraint.rows[0].definition);
          const foundValues = [...new Set(definition.match(/\d+/g) ?? [])].sort((a, b) => Number(a) - Number(b));
          const expectedValues = ['15', '30', '45', '60', '90', '120', '180', '240'];
          if (JSON.stringify(foundValues) !== JSON.stringify(expectedValues)) {
            throw new Error(`Tenant database ${tenant.database_name} has an unexpected appointment duration constraint; stopped before applying migrations.`);
          }
        }

        if (columns.has('products.appointment_duration_minutes')) {
          const invalidDurations = await db.query(
            `SELECT count(*)::int AS n
               FROM public.products
              WHERE appointment_duration_minutes IS NULL
                 OR appointment_duration_minutes NOT IN (15, 30, 45, 60, 90, 120, 180, 240)`,
          );
          if (invalidDurations.rows[0].n > 0) {
            throw new Error(`Tenant database ${tenant.database_name} contains appointment durations outside the supported set; stopped before applying migrations.`);
          }
        }
      } finally {
        await db.end();
      }
    }

    console.log(`Preflight passed for ${tenants.length} tenant database(s).`);
    const applyRequested = process.argv.includes('--apply');
    if (!applyRequested) {
      console.log('Dry run only: no changes were made. Use the explicit --apply flag only in the configured Railway pre-deploy migration step.');
      return;
    }
    const backupConfirmed = process.env.TENANT_MIGRATION_BACKUP_CONFIRMED === 'true';
    const explicitlyApprovedWithoutBackup =
      (process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' &&
        process.env.PROCEED_WITHOUT_BACKUP === 'true') ||
      process.env.TENANT_MIGRATION_ALLOW_WITHOUT_BACKUP === 'true';

    if (!backupConfirmed && !explicitlyApprovedWithoutBackup) {
      throw new Error(
        'A verified backup is required. For a manual one-time exception, run this workflow with proceed_without_backup=true.',
      );
    }

    if (explicitlyApprovedWithoutBackup && !backupConfirmed) {
      console.warn(
        'WARNING: the no-backup approval flag is active. ALL currently pending tenant migrations may run without a verified backup. If this was a one-time approval, reset TENANT_MIGRATION_ALLOW_WITHOUT_BACKUP=false immediately after the successful deployment.',
      );
    }
    console.log('Applying additive tenant migrations...');
    for (const tenant of tenants) {
      const db = await connect(databaseUrl(tenant.database_name), `tenant database ${tenant.database_name}`);
      try {
        const applied = await applyTenantMigrations(db);
        const postflight = await db.query(
          `SELECT to_regclass('public.appointments') AS appointments,
                  to_regclass('public.appointment_blocks') AS appointment_blocks,
                  to_regclass('public.products') AS products,
                  to_regclass('public.product_images') AS product_images,
                  to_regclass('public.leads') AS leads,
                  to_regclass('public.business_domains') AS business_domains,
                  to_regclass('public.crm_retention_policy') AS crm_retention_policy`,
        );
        const post = postflight.rows[0];
        if (!post.appointments || !post.appointment_blocks || !post.products || !post.product_images || !post.leads || !post.business_domains || !post.crm_retention_policy) {
          throw new Error(`Postflight failed for ${tenant.database_name}: expected booking/custom-domain/product-image tables are missing.`);
        }
        const productDetailsColumn = await db.query(
          `SELECT data_type, is_nullable
             FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'details'`,
        );
        if (!productDetailsColumn.rowCount || productDetailsColumn.rows[0].data_type !== 'jsonb' || productDetailsColumn.rows[0].is_nullable !== 'NO') {
          throw new Error(`Postflight failed for ${tenant.database_name}: products.details is missing or has an unexpected definition.`);
        }
        const productImagesSecurity = await db.query(
          `SELECT c.relrowsecurity, c.relforcerowsecurity,
                  EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = 'product_images' AND p.policyname = 'tenant_isolation') AS tenant_policy,
                  has_table_privilege('app_runtime', 'public.product_images', 'SELECT') AS can_select,
                  has_table_privilege('app_runtime', 'public.product_images', 'INSERT') AS can_insert,
                  has_table_privilege('app_runtime', 'public.product_images', 'UPDATE') AS can_update,
                  has_table_privilege('app_runtime', 'public.product_images', 'DELETE') AS can_delete
             FROM pg_class c WHERE c.oid = 'public.product_images'::regclass`,
        );
        const security = productImagesSecurity.rows[0];
        if (!security?.relrowsecurity || !security.relforcerowsecurity || !security.tenant_policy ||
            !security.can_select || !security.can_insert || !security.can_update || !security.can_delete) {
          throw new Error(`Postflight failed for ${tenant.database_name}: product_images tenant isolation or app_runtime permissions are incomplete.`);
        }
        const requiredColumns = await db.query(
          `SELECT table_name, column_name
             FROM information_schema.columns
            WHERE table_schema = 'public'
              AND ((table_name = 'products' AND column_name = 'booking_mode')
                OR (table_name = 'leads' AND column_name IN ('idempotency_key', 'retention_closed_at', 'retention_expires_at'))
                OR (table_name = 'appointments' AND column_name IN ('lead_id', 'start_at', 'end_at', 'status', 'source'))
                OR (table_name = 'appointment_blocks' AND column_name IN ('start_at', 'end_at')))`,
        );
        const present = new Set(requiredColumns.rows.map((row) => `${row.table_name}.${row.column_name}`));
        for (const required of [
          'products.booking_mode', 'leads.idempotency_key', 'leads.retention_closed_at', 'leads.retention_expires_at',
          'appointments.lead_id', 'appointments.start_at', 'appointments.end_at',
          'appointments.status', 'appointments.source',
          'appointment_blocks.start_at', 'appointment_blocks.end_at',
        ]) {
          if (!present.has(required)) throw new Error(`Postflight failed for ${tenant.database_name}: missing ${required}.`);
        }
        const retentionAppointmentFk = await db.query(
          `SELECT pg_get_constraintdef(oid) AS definition
             FROM pg_constraint
            WHERE conrelid = 'public.appointments'::regclass
              AND conname = 'appointments_tenant_id_lead_id_fkey'`,
        );
        if (!retentionAppointmentFk.rowCount ||
            !String(retentionAppointmentFk.rows[0].definition).includes('ON DELETE SET NULL (lead_id)')) {
          throw new Error(`Postflight failed for ${tenant.database_name}: CRM deletion would not preserve calendar appointments.`);
        }
        const retentionPolicySecurity = await db.query(
          `SELECT c.relrowsecurity, c.relforcerowsecurity,
                  EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = 'crm_retention_policy' AND p.policyname = 'tenant_isolation') AS tenant_policy,
                  has_table_privilege('app_runtime', 'public.crm_retention_policy', 'SELECT') AS can_select
             FROM pg_class c WHERE c.oid = 'public.crm_retention_policy'::regclass`,
        );
        const retentionPolicy = retentionPolicySecurity.rows[0];
        if (!retentionPolicy?.relrowsecurity || !retentionPolicy.relforcerowsecurity ||
            !retentionPolicy.tenant_policy || !retentionPolicy.can_select) {
          throw new Error(`Postflight failed for ${tenant.database_name}: CRM retention policy tenant isolation or app_runtime SELECT permission is incomplete.`);
        }
        const retentionTrigger = await db.query(
          `SELECT 1 FROM pg_trigger
            WHERE tgrelid = 'public.leads'::regclass
              AND tgname = 'trg_leads_retention_deadline'
              AND NOT tgisinternal`,
        );
        if (!retentionTrigger.rowCount) {
          throw new Error(`Postflight failed for ${tenant.database_name}: CRM retention deadline trigger is missing.`);
        }
        const overlapConstraint = await db.query(
          `SELECT 1 FROM pg_constraint
            WHERE conrelid = 'public.appointments'::regclass
              AND conname = 'appointments_no_reserved_overlap'`,
        );
        if (!overlapConstraint.rowCount) {
          throw new Error(`Postflight failed for ${tenant.database_name}: overlap protection is missing.`);
        }
        console.log(`${tenant.database_name}: ${applied.length ? applied.join(', ') : 'already up to date'}; booking postflight passed`);
      } finally {
        await db.end();
      }
    }
    console.log('Tenant schema migrations completed. No tenant databases or business rows were deleted.');
  } finally {
    await registry.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
