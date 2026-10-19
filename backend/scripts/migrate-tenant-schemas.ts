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
                  to_regclass('public.portfolio_images') AS portfolio_images`,
        );
        const row = schema.rows[0];
        if (!row.businesses || !row.products || !row.portfolio_images) {
          throw new Error(`Tenant database ${tenant.database_name} is missing expected core tables; stopped before applying migrations.`);
        }
      } finally {
        await db.end();
      }
    }

    console.log(`Preflight passed for ${tenants.length} tenant database(s). Applying additive migrations...`);
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
