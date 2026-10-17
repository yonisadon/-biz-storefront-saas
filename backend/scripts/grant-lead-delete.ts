import pg from 'pg';

const adminUrl = process.env.DATABASE_ADMIN_URL;
const registryUrl = process.env.SUPERADMIN_DATABASE_URL;
const ssl = process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined;

if (!adminUrl || !registryUrl) {
  throw new Error('DATABASE_ADMIN_URL and SUPERADMIN_DATABASE_URL are required');
}

function dbUrl(databaseName: string) {
  const url = new URL(adminUrl!);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function identifier(value: string) {
  return '"' + value.replace(/"/g, '""') + '"';
}

/**
 * Applies the lead-delete privilege to already-provisioned tenant databases.
 * This changes permissions only; it does not delete or modify inquiry data.
 * Run deliberately before deploying the seller deletion endpoint.
 */
async function main() {
  const registry = new pg.Client({ connectionString: registryUrl, ssl });
  const admin = new pg.Client({ connectionString: adminUrl, ssl });
  await registry.connect();
  await admin.connect();

  try {
    const mappings = await registry.query(
      'SELECT tenant_id, database_name FROM app.tenant_databases ORDER BY database_name',
    );

    for (const mapping of mappings.rows) {
      const expected = `biz_${String(mapping.tenant_id).replace(/-/g, '').slice(0, 24)}`;
      if (mapping.database_name !== expected || !/^biz_[a-f0-9]{24}$/.test(mapping.database_name)) {
        throw new Error(`Refusing unexpected database mapping for tenant ${mapping.tenant_id}`);
      }

      const tenant = new pg.Client({ connectionString: dbUrl(mapping.database_name), ssl });
      await tenant.connect();
      try {
        await tenant.query(`GRANT DELETE ON public.leads TO app_runtime`);
        console.log(`UPDATED ${mapping.database_name}`);
      } finally {
        await tenant.end();
      }
    }

    console.log(`Done. Updated ${mappings.rowCount ?? mappings.rows.length} tenant database(s); no inquiry rows were changed.`);
  } finally {
    await admin.end();
    await registry.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
