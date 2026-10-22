import pg from 'pg';

const registryUrl = process.env.APP_DATABASE_URL;
const ssl = process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined;
if (!registryUrl) throw new Error('APP_DATABASE_URL is required');

function databaseUrl(databaseName: string): string {
  const url = new URL(registryUrl!);
  url.pathname = `/${databaseName}`;
  return url.toString();
}
function expectedDatabaseName(tenantId: string): string {
  return `biz_${tenantId.replace(/-/g, '').slice(0, 24)}`;
}
async function connect(connectionString: string): Promise<pg.Client> {
  const client = new pg.Client({ connectionString, ssl, connectionTimeoutMillis: 5000 });
  await client.connect();
  return client;
}

async function main() {
  const registry = await connect(registryUrl!);
  let totalDeleted = 0;
  try {
    const result = await registry.query(
      'SELECT tenant_id, database_name FROM app.tenant_databases ORDER BY tenant_id',
    );
    const tenants = result.rows as { tenant_id: string; database_name: string }[];
    for (const tenant of tenants) {
      if (tenant.database_name !== expectedDatabaseName(tenant.tenant_id)) {
        throw new Error(`Unexpected database mapping for tenant ${tenant.tenant_id}; refusing cleanup.`);
      }
      const db = await connect(databaseUrl(tenant.database_name));
      try {
        await db.query('BEGIN');
        await db.query(
          "SELECT set_config('app.current_tenant', $1, true), set_config('statement_timeout', '10000', true)",
          [tenant.tenant_id],
        );
        const deleted = await db.query(
          "DELETE FROM public.appointments WHERE end_at <= now() RETURNING id",
        );
        await db.query('COMMIT');
        totalDeleted += deleted.rowCount ?? 0;
        console.log(`${tenant.database_name}: removed ${deleted.rowCount ?? 0} expired appointment(s)`);
      } catch (error) {
        await db.query('ROLLBACK').catch(() => {});
        throw new Error(`Cleanup failed for ${tenant.database_name}: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        await db.end();
      }
    }
    console.log(`Expired appointment cleanup complete. Tenants: ${tenants.length}; deleted: ${totalDeleted}.`);
  } finally {
    await registry.end();
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
