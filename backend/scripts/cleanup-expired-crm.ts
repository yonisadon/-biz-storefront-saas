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
  let totalLeadsDeleted = 0;
  let totalAppointmentsUnlinked = 0;
  try {
    const result = await registry.query(
      'SELECT tenant_id, database_name FROM app.tenant_databases ORDER BY tenant_id',
    );
    const tenants = result.rows as { tenant_id: string; database_name: string }[];

    for (const tenant of tenants) {
      if (tenant.database_name !== expectedDatabaseName(tenant.tenant_id)) {
        throw new Error(`Unexpected database mapping for tenant ${tenant.tenant_id}; refusing CRM cleanup.`);
      }
      const db = await connect(databaseUrl(tenant.database_name));
      try {
        await db.query('BEGIN');
        await db.query(
          "SELECT set_config('app.current_tenant', $1, true), set_config('statement_timeout', '30000', true)",
          [tenant.tenant_id],
        );
        const required = await db.query(
          `SELECT
             EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='leads' AND column_name='retention_expires_at') AS has_deadline,
             EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.appointments'::regclass AND conname='appointments_tenant_id_lead_id_fkey' AND pg_get_constraintdef(oid) LIKE '%ON DELETE SET NULL (lead_id)%') AS preserves_appointments`,
        );
        if (!required.rows[0]?.has_deadline || !required.rows[0]?.preserves_appointments) {
          throw new Error(`CRM retention migration is incomplete for ${tenant.database_name}; no rows were deleted.`);
        }

        // The FK converts lead_id to NULL on surviving appointments; appointments,
        // their time reservations and manual calendar entries are not deleted.
        const deleted = await db.query(
          `DELETE FROM public.leads
            WHERE retention_expires_at IS NOT NULL
              AND retention_expires_at <= now()
            RETURNING id`,
        );
        const unlinked = await db.query(
          `SELECT count(*)::int AS n FROM public.appointments
            WHERE lead_id IS NULL AND source = 'website' AND status = 'reserved'`,
        );
        await db.query('COMMIT');
        totalLeadsDeleted += deleted.rowCount ?? 0;
        totalAppointmentsUnlinked += Number(unlinked.rows[0]?.n ?? 0);
        console.log(`${tenant.database_name}: deleted ${deleted.rowCount ?? 0} expired CRM lead(s); ${unlinked.rows[0]?.n ?? 0} active website appointment(s) currently have no CRM lead.`);
      } catch (error) {
        await db.query('ROLLBACK').catch(() => {});
        throw new Error(`CRM cleanup failed for ${tenant.database_name}: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        await db.end();
      }
    }
    console.log(`CRM retention cleanup complete. Tenants: ${tenants.length}; leads deleted: ${totalLeadsDeleted}; active unlinked appointments observed: ${totalAppointmentsUnlinked}.`);
  } finally {
    await registry.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
