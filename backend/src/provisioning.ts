import { randomBytes, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { env } from './config';
import { HttpError } from './errors';
import { normalizeILPhone } from './util';
import { applyTenantMigrations } from './tenantMigrations';
import { ensureCrmRetentionPolicy } from './crmRetention';

export type OwnerBusinessInput = {
  name: string;
  slug: string;
  whatsapp_number?: string;
};

export type OwnerIdentity = {
  id: string;
  email: string;
  phone: string;
};

const TRANSIENT_DB_CODES = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH',
  '57P03', '08001', '08006',
]);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function connectClientWithRetry(connectionString: string): Promise<pg.Client> {
  const options = { ssl: env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined };
  for (let attempt = 1; attempt <= 12; attempt++) {
    const client = new pg.Client({ connectionString, ...options, connectionTimeoutMillis: 5000 });
    try {
      await client.connect();
      return client;
    } catch (error) {
      await client.end().catch(() => {});
      const code = (error as { code?: string }).code;
      if (!code || !TRANSIENT_DB_CODES.has(code) || attempt === 12) throw error;
      await sleep(Math.min(1000 * attempt, 5000));
    }
  }
  throw new Error('PostgreSQL did not become available');
}

function databaseUrl(baseUrl: string, databaseName: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function quoteIdentifier(identifier: string): string {
  return '"' + identifier.replace(/"/g, '""') + '"';
}

export async function provisionBusinessForOwner(
  owner: OwnerIdentity,
  input: OwnerBusinessInput,
): Promise<{ id: string; name: string; slug: string; database: string; trial_ends_at: string }> {
  if (!env.SUPERADMIN_DATABASE_URL || !env.DATABASE_ADMIN_URL || !env.PUBLIC_BASE_URL) {
    throw new HttpError(503, 'provisioning_not_configured');
  }
  const whatsapp = input.whatsapp_number?.trim()
    ? normalizeILPhone(input.whatsapp_number)
    : null;
  if (input.whatsapp_number?.trim() && !whatsapp) throw new HttpError(400, 'invalid_il_phone');

  const options = { ssl: env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined };
  let registry: pg.Client | undefined;
  let databaseAdmin: pg.Client | undefined;
  let tenantAdmin: pg.Client | undefined;
  let tenantId: string | undefined;
  let databaseName: string | undefined;
  let databaseCreated = false;

  try {
    registry = await connectClientWithRetry(env.SUPERADMIN_DATABASE_URL);
    databaseAdmin = await connectClientWithRetry(env.DATABASE_ADMIN_URL);

    const existingOwner = await registry.query(
      'SELECT 1 FROM public.platform_business_owners WHERE user_id = $1 LIMIT 1',
      [owner.id],
    );
    if (existingOwner.rowCount) throw new HttpError(409, 'business_already_exists');

    const duplicateContact = await registry.query(
      'SELECT 1 FROM public.businesses WHERE lower(COALESCE(email, \'\')) = $1 LIMIT 1',
      [owner.email.toLowerCase()],
    );
    if (duplicateContact.rowCount) throw new HttpError(409, 'business_contact_already_registered');

    await registry.query('BEGIN');
    try {
      const created = await registry.query(
        'SELECT app.create_business($1, $2, $3, $4::jsonb) AS id',
        [
          input.slug,
          input.name,
          whatsapp,
          JSON.stringify({
            opening_hours: {
              days: { sun: [], mon: [], tue: [], wed: [], thu: [], fri: [], sat: [] },
              out_of_hours_banner: { enabled: false, message: '' },
            },
          }),
        ],
      );
      tenantId = created.rows[0]?.id;
      if (!tenantId) throw new Error('business_creation_failed');
      await registry.query(
        'UPDATE public.businesses SET phone = $2, email = $3, status = $4 WHERE id = $1',
        [tenantId, owner.phone, owner.email, 'suspended'],
      );
      await registry.query('COMMIT');
    } catch (error) {
      await registry.query('ROLLBACK').catch(() => {});
      throw error;
    }

    databaseName = `biz_${tenantId.replace(/-/g, '').slice(0, 24)}`;
    await databaseAdmin.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
    databaseCreated = true;
    await databaseAdmin.query(`GRANT CONNECT ON DATABASE ${quoteIdentifier(databaseName)} TO app_runtime, app_superadmin`);

    tenantAdmin = await connectClientWithRetry(databaseUrl(env.DATABASE_ADMIN_URL, databaseName));
    const schema = readFileSync(join(process.cwd(), 'migrations/tenant-schema.sql'), 'utf8');
    await tenantAdmin.query(schema);
    await applyTenantMigrations(tenantAdmin);

    const business = await registry.query(
      `SELECT id, slug, name, status, whatsapp_number, phone, email, about_text,
              locale, timezone, config
         FROM public.businesses WHERE id = $1`,
      [tenantId],
    );
    const b = business.rows[0];
    if (!b) throw new Error('created_business_not_found');

    await tenantAdmin.query(
      `INSERT INTO public.businesses
         (id, slug, name, status, whatsapp_number, phone, email, about_text, locale, timezone, config)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)`,
      [b.id, b.slug, b.name, 'active', b.whatsapp_number, b.phone, b.email,
       b.about_text, b.locale, b.timezone, JSON.stringify(b.config)],
    );
    await ensureCrmRetentionPolicy(tenantAdmin, tenantId);

    const client = registry;
    if (!client) throw new Error('registry_connection_unavailable');
    let trialEndsAt = '';
    try {
      await client.query('BEGIN');
      await client.query(
        'INSERT INTO app.tenant_databases (tenant_id, database_name) VALUES ($1, $2)',
        [tenantId, databaseName],
      );
      await client.query(
        'INSERT INTO public.platform_business_owners (user_id, tenant_id) VALUES ($1, $2)',
        [owner.id, tenantId],
      );
      const subscription = await client.query(
        `INSERT INTO public.platform_subscriptions
           (tenant_id, status, plan_code, trial_started_at, trial_ends_at)
         VALUES ($1, 'trialing', 'standard', now(), now() + interval '30 days')
         RETURNING trial_ends_at`,
        [tenantId],
      );
      trialEndsAt = subscription.rows[0].trial_ends_at;
      await client.query(
        'INSERT INTO public.platform_audit_log (actor_type, actor_user_id, actor_email, action, tenant_id, metadata) VALUES (\'owner\', $1, $2, \'business_created\', $3, $4::jsonb)',
        [owner.id, owner.email, tenantId, JSON.stringify({ slug: input.slug, trial_days: 30 })],
      );
      await client.query('UPDATE public.businesses SET status = $2 WHERE id = $1', [tenantId, 'active']);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    }

    return { id: tenantId, name: b.name, slug: b.slug, database: databaseName, trial_ends_at: trialEndsAt };
  } catch (error) {
    if (tenantAdmin) await tenantAdmin.end().catch(() => {});
    if (databaseCreated && databaseName && databaseAdmin) {
      await databaseAdmin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)} WITH (FORCE)`).catch(() => {});
    }
    if (tenantId && registry) {
      await registry.query('DELETE FROM public.businesses WHERE id = $1', [tenantId]).catch(() => {});
    }
    if ((error as { code?: string }).code === '23505') {
      throw new HttpError(409, 'slug_or_business_contact_already_exists');
    }
    if (error instanceof HttpError) throw error;
    throw new HttpError(500, 'business_provisioning_failed');
  } finally {
    if (tenantAdmin) await tenantAdmin.end().catch(() => {});
    if (databaseAdmin) await databaseAdmin.end().catch(() => {});
    if (registry) await registry.end().catch(() => {});
  }
}

export function createManagementToken(): { token: string; tokenHash: Buffer } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: createHash('sha256').update(token, 'utf8').digest() };
}
