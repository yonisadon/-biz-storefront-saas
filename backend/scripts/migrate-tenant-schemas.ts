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

async function connect(connectionString: string): Promise<pg.Client> {
  const client = new pg.Client({
    connectionString,
    ssl,
    connectionTimeoutMillis: 5000,
  });
  await client.connect();
  return client;
}

async function main() {
  const registry = await connect(registryUrl!);
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
      const db = await connect(databaseUrl(tenant.database_name));
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
    if (process.env.APPLY_TENANT_MIGRATIONS !== 'true') {
      console.log('Dry run only: no changes were made. After a verified backup and explicit approval, set both APPLY_TENANT_MIGRATIONS=true and TENANT_MIGRATION_BACKUP_CONFIRMED=true.');
      return;
    }
    if (process.env.TENANT_MIGRATION_BACKUP_CONFIRMED !== 'true') {
      throw new Error('Refusing to apply tenant migrations without TENANT_MIGRATION_BACKUP_CONFIRMED=true after verifying a restorable backup.');
    }

    console.log('Applying additive tenant migrations...');
    for (const tenant of tenants) {
      const db = await connect(databaseUrl(tenant.database_name));
      try {
        const applied = await applyTenantMigrations(db);
        console.log(`${tenant.database_name}: ${applied.length ? applied.join(', ') : 'already up to date'}`);
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
