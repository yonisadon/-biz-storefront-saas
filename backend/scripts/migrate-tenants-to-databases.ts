import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { applyTenantMigrations } from '../src/tenantMigrations';

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

async function main() {
  const registry = new pg.Client({ connectionString: registryUrl, ssl });
  const admin = new pg.Client({ connectionString: adminUrl, ssl });
  await registry.connect();
  await admin.connect();
  let tenantAdmin: pg.Client | undefined;

  try {
    const schema = readFileSync(join(__dirname, '../migrations/tenant-schema.sql'), 'utf8');
    const businesses = await registry.query(
      `SELECT id, slug, name, status, whatsapp_number, phone, email, about_text,
              locale, timezone, config
         FROM public.businesses ORDER BY created_at`,
    );

    for (const b of businesses.rows) {
      const mapped = await registry.query(
        'SELECT database_name FROM app.tenant_databases WHERE tenant_id = $1',
        [b.id],
      );
      if (mapped.rows[0]) {
        console.log(`SKIP ${b.slug}: already mapped to ${mapped.rows[0].database_name}`);
        continue;
      }

      const databaseName = `biz_${String(b.id).replace(/-/g, '').slice(0, 24)}`;
      let databaseCreated = false;
      // Hide this storefront while its snapshot is copied. Requests already in
      // flight are given time to finish before copying begins.
      await registry.query('UPDATE public.businesses SET status = $2 WHERE id = $1', [b.id, 'suspended']);
      await new Promise((resolve) => setTimeout(resolve, 6000));
      tenantAdmin = undefined;
      try {
        await admin.query(`CREATE DATABASE ${identifier(databaseName)}`);
        databaseCreated = true;
        await admin.query(`GRANT CONNECT ON DATABASE ${identifier(databaseName)} TO app_runtime, app_superadmin`);
        tenantAdmin = new pg.Client({ connectionString: dbUrl(databaseName), ssl });
        await tenantAdmin.connect();
        await tenantAdmin.query(schema);
        await applyTenantMigrations(tenantAdmin);

        const businessColumns = [
          'id', 'slug', 'name', 'status', 'whatsapp_number', 'phone', 'email',
          'about_text', 'locale', 'timezone', 'config', 'created_at', 'updated_at',
        ];
        const businessValues = businessColumns.map((column) => column === 'status' ? 'suspended' : b[column]);
        await tenantAdmin.query(
          `INSERT INTO public.businesses (${businessColumns.map(identifier).join(', ')})
           VALUES (${businessValues.map((_, i) => '$' + (i + 1)).join(', ')})`,
          businessValues,
        );

        // Copy in FK-safe order. Access tokens stay in the registry database,
        // because token resolution must work before the tenant DB is selected.
        for (const table of [
          'media_assets', 'products', 'leads', 'lead_items',
          'lead_notes', 'portfolio_images', 'business_domains',
        ]) {
          const rows = await registry.query(
            `SELECT * FROM public.${identifier(table)} WHERE tenant_id = $1`,
            [b.id],
          );
          for (const row of rows.rows) {
            const columns = Object.keys(row);
            const values = columns.map((column) => row[column]);
            await tenantAdmin.query(
              `INSERT INTO public.${identifier(table)} (${columns.map(identifier).join(', ')})
               VALUES (${values.map((_, i) => '$' + (i + 1)).join(', ')})`,
              values,
            );
          }
          console.log(`  copied ${rows.rowCount ?? rows.rows.length} rows from ${table}`);
        }

        await registry.query(
          'INSERT INTO app.tenant_databases (tenant_id, database_name) VALUES ($1, $2)',
          [b.id, databaseName],
        );
        await tenantAdmin.query('UPDATE public.businesses SET status = $2 WHERE id = $1', [b.id, b.status]);
        await registry.query('UPDATE public.businesses SET status = $2 WHERE id = $1', [b.id, b.status]);
        console.log(`MIGRATED ${b.slug} -> ${databaseName}`);
      } catch (err) {
        await registry.query('DELETE FROM app.tenant_databases WHERE tenant_id = $1', [b.id]).catch(() => {});
        if (tenantAdmin) {
          await tenantAdmin.end().catch(() => {});
          tenantAdmin = undefined;
        }
        if (databaseCreated) {
          await admin.query(`DROP DATABASE IF EXISTS ${identifier(databaseName)} WITH (FORCE)`).catch(() => {});
        }
        await registry.query('UPDATE public.businesses SET status = $2 WHERE id = $1', [b.id, b.status]).catch(() => {});
        throw new Error(`Migration failed for ${b.slug}: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        if (tenantAdmin) {
          await tenantAdmin.end();
          tenantAdmin = undefined;
        }
      }
    }
  } finally {
    if (tenantAdmin) await tenantAdmin.end().catch(() => {});
    await admin.end();
    await registry.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
