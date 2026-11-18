import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveTxt } from 'node:dns/promises';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import pg from 'pg';
import { z } from 'zod';
import { env } from '../config';
import { HttpError } from '../errors';
import { normalizeILPhone } from '../util';
import { applyTenantMigrations } from '../tenantMigrations';
import { normalizeDomain } from '../domain';
import { storage, variantKeys } from '../storage';

const CreateBusiness = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().toLowerCase().min(2).max(63).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  phone: z.string().trim().max(40).optional(),
  whatsapp_number: z.string().trim().max(40).optional(),
  email: z.string().trim().email().max(254).optional().or(z.literal('')),
  branding: z.object({ colors: z.object({
    primary: z.string().regex(/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i), secondary: z.string().regex(/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i),
    accent: z.string().regex(/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i), background: z.string().regex(/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i),
    text: z.string().regex(/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i),
  }).strict(),
    business_title_color: z.enum(['brand', 'black']).optional(),
    storefront_theme: z.enum(['soft', 'flat', 'editorial', 'creative']).optional(),
    hero_gallery_layout: z.enum(['slider', 'thumbnails']).optional(),
    product_layout: z.enum(['cards', 'gallery', 'list', 'grid', 'carousel', 'luxury_catalog']).optional(),
    service_layout: z.enum(['cards', 'gallery', 'list', 'grid', 'carousel', 'luxury_catalog']).optional(),
  }).strict().optional(),
}).strict();



const BusinessStatusInput = z.object({
  status: z.enum(['active', 'suspended', 'archived']),
  reason: z.string().trim().max(500).optional(),
}).strict();

const SubscriptionInput = z.object({
  status: z.enum(['trialing', 'active', 'past_due', 'canceled', 'suspended']),
  trial_ends_at: z.string().datetime().optional().nullable(),
  current_period_ends_at: z.string().datetime().optional().nullable(),
}).strict();

const DeletionReviewInput = z.object({
  decision: z.enum(['approve', 'reject']),
  note: z.string().trim().max(1000).optional(),
}).strict();

const DomainInput = z.object({
  domain: z.string().trim().min(4).max(253),
}).strict();

function requireDomain(input: string): string {
  const domain = normalizeDomain(input);
  if (!domain) throw new HttpError(400, 'invalid_domain');
  return domain;
}

async function getTenantDatabase(registry: pg.Client, tenantId: string): Promise<string> {
  const row = await registry.query(
    'SELECT database_name FROM app.tenant_databases WHERE tenant_id = $1',
    [tenantId],
  );
  const databaseName = row.rows[0]?.database_name as string | undefined;
  if (!databaseName || !/^biz_[a-f0-9]{24}$/.test(databaseName)) {
    throw new HttpError(404, 'business_not_found');
  }
  return databaseName;
}

async function hasDomainVerification(domain: string, tenantId: string): Promise<boolean> {
  try {
    const records = await resolveTxt(`_torahtrainer-verification.${domain}`);
    const expected = `torahtrainer-verification=${tenantId}`;
    return records.some((record) => record.join('').trim() === expected);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'ENODATA' || code === 'ENOTFOUND' || code === 'ENOTIMP' || code === 'ESERVFAIL') return false;
    throw err;
  }
}

function phone(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  const normalized = normalizeILPhone(value);
  if (!normalized) throw new HttpError(400, 'invalid_il_phone');
  return normalized;
}

function databaseUrl(baseUrl: string, databaseName: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function quoteIdentifier(identifier: string): string {
  return '"' + identifier.replace(/"/g, '""') + '"';
}


const TRANSIENT_DB_CODES = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH',
  '57P03', '08001', '08006',
]);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function connectClientWithRetry(
  connectionString: string,
  options: Omit<pg.ClientConfig, 'connectionString'> = {},
): Promise<pg.Client> {
  const maxAttempts = 12;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const client = new pg.Client({
      ...options,
      connectionString,
      connectionTimeoutMillis: 5000,
    });
    try {
      await client.connect();
      return client;
    } catch (err) {
      await client.end().catch(() => {});
      const code = (err as { code?: string }).code;
      if (!code || !TRANSIENT_DB_CODES.has(code) || attempt === maxAttempts) throw err;
      const delayMs = Math.min(1000 * attempt, 5000);
      console.warn(`PostgreSQL is not ready (attempt ${attempt}/${maxAttempts}); retrying in ${delayMs}ms.`);
      await sleep(delayMs);
    }
  }
  throw new Error('PostgreSQL did not become available');
}

function authorized(req: FastifyRequest): boolean {
  const expected = env.SUPERADMIN_API_TOKEN;
  if (!expected) return false;
  const raw = String(req.headers.authorization ?? '');
  const supplied = raw.startsWith('Bearer ') ? raw.slice(7) : '';
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function authorizedBySession(req: FastifyRequest): Promise<boolean> {
  if (!env.SUPERADMIN_EMAIL || !env.SUPERADMIN_DATABASE_URL) return false;
  const raw = String(req.headers.cookie ?? '');
  const sessionCookie = raw.split(';').map((part) => part.trim()).find((part) => part.startsWith('btime_session='));
  const token = sessionCookie ? decodeURIComponent(sessionCookie.slice('btime_session='.length)) : '';
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  let registry: pg.Client | undefined;
  try {
    registry = await connectClientWithRetry(env.SUPERADMIN_DATABASE_URL, {
      ssl: env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    });
    const result = await registry.query(
      `SELECT 1
         FROM public.platform_sessions s
         JOIN public.platform_users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
          AND u.role = 'super_admin' AND lower(u.email) = lower($2)
          AND u.email_verified_at IS NOT NULL AND u.disabled_at IS NULL
        LIMIT 1`,
      [createHash('sha256').update(token, 'utf8').digest(), env.SUPERADMIN_EMAIL],
    );
    return Boolean(result.rowCount);
  } catch {
    return false;
  } finally {
    if (registry) await registry.end().catch(() => {});
  }
}

export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', async (req) => {
    if (!env.SUPERADMIN_API_TOKEN && !env.SUPERADMIN_EMAIL) throw new HttpError(503, 'admin_not_configured');
    if (!authorized(req) && !(await authorizedBySession(req))) throw new HttpError(401, 'unauthorized');
  });

  app.post('/businesses', async (req, reply) => {
    const input = CreateBusiness.parse(req.body);
    if (!env.SUPERADMIN_DATABASE_URL || !env.DATABASE_ADMIN_URL || !env.PUBLIC_BASE_URL) {
      throw new HttpError(503, 'provisioning_not_configured');
    }

    const phoneNumber = phone(input.phone);
    const whatsappNumber = phone(input.whatsapp_number);
    const clientOptions = { ssl: env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined };
    let registry: pg.Client | undefined;
    let databaseAdmin: pg.Client | undefined;
    let tenantAdmin: pg.Client | undefined;
    let tenantId: string | undefined;
    let databaseName: string | undefined;
    let databaseCreated = false;

    try {
      // Both connections can race PostgreSQL's wake-up after a quiet period.
      registry = await connectClientWithRetry(env.SUPERADMIN_DATABASE_URL, clientOptions);
      databaseAdmin = await connectClientWithRetry(env.DATABASE_ADMIN_URL, clientOptions);

      // Create the registry row as suspended atomically so no request can
      // resolve a partially provisioned storefront between these statements.
      await registry.query('BEGIN');
      try {
        const created = await registry.query(
          'SELECT app.create_business($1, $2, $3, $4::jsonb) AS id',
          [
            input.slug,
            input.name,
            whatsappNumber,
            JSON.stringify({
              ...(input.branding ? { branding: input.branding } : {}),
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
          [tenantId, phoneNumber, input.email || null, 'suspended'],
        );
        await registry.query('COMMIT');
      } catch (err) {
        await registry.query('ROLLBACK').catch(() => {});
        throw err;
      }

      // Database identifiers are generated from the server-created UUID, never user input.
      databaseName = `biz_${tenantId.replace(/-/g, '').slice(0, 24)}`;
      await databaseAdmin.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
      databaseCreated = true;
      await databaseAdmin.query(`GRANT CONNECT ON DATABASE ${quoteIdentifier(databaseName)} TO app_runtime, app_superadmin`);

      tenantAdmin = await connectClientWithRetry(
        databaseUrl(env.DATABASE_ADMIN_URL, databaseName),
        clientOptions,
      );

      // Each new database gets the exact same schema as the current application.
      const schema = readFileSync(join(process.cwd(), 'migrations/tenant-schema.sql'), 'utf8');
      await tenantAdmin.query(schema);
      await applyTenantMigrations(tenantAdmin);

      const business = await registry.query(
        `SELECT id, slug, name, status, whatsapp_number, phone, email, about_text,
                locale, timezone, config
           FROM public.businesses WHERE id = $1`,
        [tenantId],
      );
      if (!business.rows[0]) throw new Error('created_business_not_found');

      const b = business.rows[0];
      await tenantAdmin.query(
        `INSERT INTO public.businesses
           (id, slug, name, status, whatsapp_number, phone, email, about_text, locale, timezone, config)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)`,
        [b.id, b.slug, b.name, b.status, b.whatsapp_number, phoneNumber, input.email || null,
         b.about_text, b.locale, b.timezone, JSON.stringify(b.config)],
      );

      // The registry DB resolves public slugs and seller tokens; only business data
      // and day-to-day operations live in the dedicated business database.
      const token = randomBytes(32).toString('base64url');
      const tokenHash = createHash('sha256').update(token, 'utf8').digest();
      await registry.query(
        'INSERT INTO public.access_tokens (tenant_id, token_hash, label) VALUES ($1, $2, $3)',
        [tenantId, tokenHash, 'initial seller link'],
      );
      await registry.query(
        'INSERT INTO app.tenant_databases (tenant_id, database_name) VALUES ($1, $2)',
        [tenantId, databaseName],
      );

      // Publish only after the dedicated DB and registry mapping are ready.
      await tenantAdmin.query('UPDATE public.businesses SET status = $2 WHERE id = $1', [tenantId, 'active']);
      await registry.query('UPDATE public.businesses SET status = $2 WHERE id = $1', [tenantId, 'active']);

      return reply.code(201).send({
        id: tenantId,
        name: b.name,
        slug: b.slug,
        database: databaseName,
        public_url: `${env.PUBLIC_BASE_URL.replace(/\/+$/, '')}/biz/${b.slug}`,
        management_url: `${env.PUBLIC_BASE_URL.replace(/\/+$/, '')}/manage/${token}`,
        status: 'active',
      });
    } catch (err) {
      // Provisioning is all-or-nothing from the user's perspective. Clean up a
      // partially created DB/business so a retry doesn't leave orphan resources.
      if (tenantAdmin) await tenantAdmin.end().catch(() => {});
      if (databaseCreated && databaseName && databaseAdmin) {
        await databaseAdmin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)} WITH (FORCE)`).catch(() => {});
      }
      if (tenantId && registry) {
        await registry.query('DELETE FROM public.businesses WHERE id = $1', [tenantId]).catch(() => {});
      }
      if ((err as { code?: string }).code === '23505') {
        throw new HttpError(409, 'slug_already_exists');
      }
      if (err instanceof HttpError) throw err;
      req.log.error({ err }, 'business provisioning failed');
      throw new HttpError(500, 'business_provisioning_failed');
    } finally {
      if (tenantAdmin) await tenantAdmin.end().catch(() => {});
      if (databaseAdmin) await databaseAdmin.end().catch(() => {});
      if (registry) await registry.end().catch(() => {});
    }
  });


  app.get('/businesses', async (req) => {
    if (!env.SUPERADMIN_DATABASE_URL) throw new HttpError(503, 'provisioning_not_configured');
    const options = { ssl: env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined };
    let registry: pg.Client | undefined;
    try {
      registry = await connectClientWithRetry(env.SUPERADMIN_DATABASE_URL, options);
      const result = await registry.query(
        `SELECT b.id, b.name, b.slug, b.status, b.email, b.phone, b.created_at,
                s.status AS subscription_status, s.trial_ends_at, s.current_period_ends_at,
                u.email AS owner_email, u.phone AS owner_phone,
                (SELECT dr.status FROM public.business_deletion_requests dr
                  WHERE dr.tenant_id = b.id ORDER BY dr.requested_at DESC LIMIT 1) AS deletion_request_status,
                COALESCE(json_agg(json_build_object('domain', d.domain, 'is_verified', d.is_verified, 'is_primary', d.is_primary)
                  ORDER BY d.is_primary DESC, d.domain) FILTER (WHERE d.id IS NOT NULL), '[]'::json) AS domains
           FROM public.businesses b
           JOIN app.tenant_databases td ON td.tenant_id = b.id
           LEFT JOIN public.business_domains d ON d.tenant_id = b.id
           LEFT JOIN public.platform_subscriptions s ON s.tenant_id = b.id
           LEFT JOIN public.platform_business_owners bo ON bo.tenant_id = b.id
           LEFT JOIN public.platform_users u ON u.id = bo.user_id
          GROUP BY b.id, s.status, s.trial_ends_at, s.current_period_ends_at, u.email, u.phone
          ORDER BY b.created_at DESC`,
      );
      return { businesses: result.rows };
    } finally {
      if (registry) await registry.end().catch(() => {});
    }
  });

  app.get('/overview', async () => {
    if (!env.SUPERADMIN_DATABASE_URL) throw new HttpError(503, 'provisioning_not_configured');
    const registry = await connectClientWithRetry(env.SUPERADMIN_DATABASE_URL, {
      ssl: env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    });
    try {
      const result = await registry.query(`
        SELECT
          (SELECT count(*)::int FROM public.businesses b JOIN app.tenant_databases td ON td.tenant_id = b.id) AS total_businesses,
          (SELECT count(*)::int FROM public.businesses b JOIN app.tenant_databases td ON td.tenant_id = b.id WHERE b.status = 'active') AS active_businesses,
          (SELECT count(*)::int FROM public.businesses b JOIN app.tenant_databases td ON td.tenant_id = b.id WHERE b.status = 'suspended') AS suspended_businesses,
          (SELECT count(*)::int FROM public.platform_subscriptions WHERE status = 'trialing' AND trial_ends_at > now()) AS trialing_subscriptions,
          (SELECT count(*)::int FROM public.platform_subscriptions WHERE status = 'active') AS paid_subscriptions,
          (SELECT count(*)::int FROM public.business_deletion_requests WHERE status = 'pending') AS pending_deletion_requests
      `);
      return result.rows[0];
    } finally {
      await registry.end().catch(() => {});
    }
  });

  app.patch('/businesses/:id/status', async (req) => {
    const tenantId = String((req.params as { id: string }).id);
    if (!/^[0-9a-f-]{36}$/i.test(tenantId)) throw new HttpError(404, 'business_not_found');
    const input = BusinessStatusInput.parse(req.body);
    if (!env.SUPERADMIN_DATABASE_URL || !env.DATABASE_ADMIN_URL) throw new HttpError(503, 'provisioning_not_configured');
    const options = { ssl: env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined };
    let registry: pg.Client | undefined;
    let tenant: pg.Client | undefined;
    try {
      registry = await connectClientWithRetry(env.SUPERADMIN_DATABASE_URL, options);
      const databaseName = await getTenantDatabase(registry, tenantId);
      const updated = await registry.query(
        'UPDATE public.businesses SET status = $2 WHERE id = $1 RETURNING id, name, slug, status',
        [tenantId, input.status],
      );
      if (!updated.rows[0]) throw new HttpError(404, 'business_not_found');
      tenant = await connectClientWithRetry(databaseUrl(env.DATABASE_ADMIN_URL, databaseName), options);
      await tenant.query('UPDATE public.businesses SET status = $2 WHERE id = $1', [tenantId, input.status]);
      await registry.query(
        "INSERT INTO public.platform_audit_log (actor_type, actor_email, action, tenant_id, metadata) VALUES ('super_admin', 'platform-admin', 'business_status_changed', $1, $2::jsonb)",
        [tenantId, JSON.stringify({ status: input.status, reason: input.reason ?? null })],
      );
      return updated.rows[0];
    } finally {
      if (tenant) await tenant.end().catch(() => {});
      if (registry) await registry.end().catch(() => {});
    }
  });

  app.patch('/businesses/:id/subscription', async (req) => {
    const tenantId = String((req.params as { id: string }).id);
    if (!/^[0-9a-f-]{36}$/i.test(tenantId)) throw new HttpError(404, 'business_not_found');
    const input = SubscriptionInput.parse(req.body);
    if (!env.SUPERADMIN_DATABASE_URL) throw new HttpError(503, 'provisioning_not_configured');
    let registry: pg.Client | undefined;
    try {
      registry = await connectClientWithRetry(env.SUPERADMIN_DATABASE_URL, {
        ssl: env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
      });
      const exists = await registry.query('SELECT 1 FROM public.businesses WHERE id = $1', [tenantId]);
      if (!exists.rowCount) throw new HttpError(404, 'business_not_found');
      const result = await registry.query(
        `INSERT INTO public.platform_subscriptions
           (tenant_id, status, plan_code, trial_started_at, trial_ends_at, current_period_ends_at, canceled_at)
         VALUES (
           $1, $2, 'standard',
           CASE WHEN $2 = 'trialing' THEN now() ELSE NULL END,
           CASE WHEN $2 = 'trialing' THEN COALESCE($3::timestamptz, now() + interval '30 days') ELSE NULL END,
           $4::timestamptz,
           CASE WHEN $2 = 'canceled' THEN now() ELSE NULL END
         )
         ON CONFLICT (tenant_id) DO UPDATE SET
           status = EXCLUDED.status,
           trial_started_at = EXCLUDED.trial_started_at,
           trial_ends_at = EXCLUDED.trial_ends_at,
           current_period_ends_at = EXCLUDED.current_period_ends_at,
           canceled_at = EXCLUDED.canceled_at,
           updated_at = now()
         RETURNING tenant_id, status, trial_started_at, trial_ends_at, current_period_ends_at, canceled_at`,
        [tenantId, input.status, input.trial_ends_at ?? null, input.current_period_ends_at ?? null],
      );
      await registry.query(
        "INSERT INTO public.platform_audit_log (actor_type, actor_email, action, tenant_id, metadata) VALUES ('super_admin', 'platform-admin', 'subscription_status_changed', $1, $2::jsonb)",
        [tenantId, JSON.stringify({ status: input.status })],
      );
      return result.rows[0];
    } finally {
      if (registry) await registry.end().catch(() => {});
    }
  });

  app.get('/deletion-requests', async () => {
    if (!env.SUPERADMIN_DATABASE_URL) throw new HttpError(503, 'provisioning_not_configured');
    const registry = await connectClientWithRetry(env.SUPERADMIN_DATABASE_URL, {
      ssl: env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    });
    try {
      const result = await registry.query(
        `SELECT dr.id, dr.tenant_id, dr.reason, dr.status, dr.requested_at,
                COALESCE(dr.business_name, b.name) AS business_name,
                COALESCE(dr.business_slug, b.slug) AS business_slug,
                dr.database_name, u.email AS owner_email, u.phone AS owner_phone
           FROM public.business_deletion_requests dr
           LEFT JOIN public.businesses b ON b.id = dr.tenant_id
           JOIN public.platform_users u ON u.id = dr.requested_by_user_id
          WHERE dr.status IN ('pending', 'approved')
          ORDER BY dr.requested_at ASC`,
      );
      return { requests: result.rows };
    } finally {
      await registry.end().catch(() => {});
    }
  });

  app.patch('/deletion-requests/:id/review', async (req) => {
    const requestId = String((req.params as { id: string }).id);
    if (!/^[0-9a-f-]{36}$/i.test(requestId)) throw new HttpError(404, 'deletion_request_not_found');
    const input = DeletionReviewInput.parse(req.body);
    if (!env.SUPERADMIN_DATABASE_URL) throw new HttpError(503, 'provisioning_not_configured');
    const registry = await connectClientWithRetry(env.SUPERADMIN_DATABASE_URL, {
      ssl: env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    });
    try {
      await registry.query('BEGIN');
      const result = await registry.query(
        `UPDATE public.business_deletion_requests
            SET status = $2, reviewed_at = now(), reviewed_by_email = 'platform-admin', review_note = $3
          WHERE id = $1 AND status = 'pending'
          RETURNING id, tenant_id, status`,
        [requestId, input.decision === 'approve' ? 'approved' : 'rejected', input.note ?? null],
      );
      if (!result.rows[0]) throw new HttpError(404, 'deletion_request_not_found');
      if (input.decision === 'approve') {
        await registry.query("UPDATE public.businesses SET status = 'suspended' WHERE id = $1", [result.rows[0].tenant_id]);
      }
      await registry.query(
        "INSERT INTO public.platform_audit_log (actor_type, actor_email, action, tenant_id, metadata) VALUES ('super_admin', 'platform-admin', 'business_deletion_reviewed', $1, $2::jsonb)",
        [result.rows[0].tenant_id, JSON.stringify({ decision: input.decision, note: input.note ?? null })],
      );
      await registry.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      await registry.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      await registry.end().catch(() => {});
    }
  });

  app.post('/deletion-requests/:id/execute', async (req) => {
    const requestId = String((req.params as { id: string }).id);
    if (!/^[0-9a-f-]{36}$/i.test(requestId)) throw new HttpError(404, 'deletion_request_not_found');
    if (!env.SUPERADMIN_DATABASE_URL || !env.DATABASE_ADMIN_URL) throw new HttpError(503, 'provisioning_not_configured');

    const options = { ssl: env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined };
    let registry: pg.Client | undefined;
    let databaseAdmin: pg.Client | undefined;
    let tenant: pg.Client | undefined;
    try {
      registry = await connectClientWithRetry(env.SUPERADMIN_DATABASE_URL, options);
      const selected = await registry.query(
        `SELECT id, tenant_id, business_name, business_slug, database_name, storage_keys, status
           FROM public.business_deletion_requests WHERE id = $1 LIMIT 1`,
        [requestId],
      );
      const request = selected.rows[0];
      if (!request) throw new HttpError(404, 'deletion_request_not_found');
      if (request.status !== 'approved') throw new HttpError(409, 'deletion_request_not_approved');

      let databaseName = request.database_name as string | null;
      let storageKeys = Array.isArray(request.storage_keys) ? request.storage_keys as string[] : [];
      if (!databaseName && request.tenant_id) {
        databaseName = await getTenantDatabase(registry, request.tenant_id);
        tenant = await connectClientWithRetry(databaseUrl(env.DATABASE_ADMIN_URL, databaseName), options);
        const assets = await tenant.query('SELECT storage_key FROM public.media_assets ORDER BY storage_key');
        storageKeys = [...new Set(assets.rows.flatMap((row: { storage_key: string }) => variantKeys(row.storage_key)))];
        await tenant.end();
        tenant = undefined;
        // Persist the cleanup manifest before touching storage or dropping the DB,
        // so an interrupted deletion can be retried safely.
        await registry.query(
          'UPDATE public.business_deletion_requests SET database_name = $2, storage_keys = $3::jsonb WHERE id = $1',
          [requestId, databaseName, JSON.stringify(storageKeys)],
        );
      }

      if (storageKeys.length) await storage.remove(storageKeys);
      if (databaseName) {
        databaseAdmin = await connectClientWithRetry(env.DATABASE_ADMIN_URL, options);
        await databaseAdmin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)} WITH (FORCE)`);
        await databaseAdmin.end();
        databaseAdmin = undefined;
      }

      await registry.query('BEGIN');
      try {
        if (request.tenant_id) {
          await registry.query('DELETE FROM public.businesses WHERE id = $1', [request.tenant_id]);
        }
        await registry.query(
          `UPDATE public.business_deletion_requests
              SET status = 'completed', completed_at = now(), tenant_id = NULL,
                  database_name = COALESCE(database_name, $2), storage_keys = $3::jsonb
            WHERE id = $1`,
          [requestId, databaseName, JSON.stringify(storageKeys)],
        );
        await registry.query(
          "INSERT INTO public.platform_audit_log (actor_type, actor_email, action, metadata) VALUES ('super_admin', 'platform-admin', 'business_deleted', $1::jsonb)",
          [JSON.stringify({ deletion_request_id: requestId, business_name: request.business_name, business_slug: request.business_slug, database_name: databaseName })],
        );
        await registry.query('COMMIT');
      } catch (error) {
        await registry.query('ROLLBACK').catch(() => {});
        throw error;
      }
      return { deleted: true, business_name: request.business_name, message: 'העסק, מסד הנתונים הייעודי וקובצי המדיה שנרשמו הוסרו.' };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      req.log.error({ err: error }, 'approved business deletion failed');
      throw new HttpError(500, 'business_deletion_failed', 'Business deletion failed; the approved request can be retried safely.');
    } finally {
      if (tenant) await tenant.end().catch(() => {});
      if (databaseAdmin) await databaseAdmin.end().catch(() => {});
      if (registry) await registry.end().catch(() => {});
    }
  });

  // ---- Custom domains (central registry + tenant DB stay synchronized) ----
  app.get('/businesses/:id/domains', async (req) => {
    const tenantId = String((req.params as { id: string }).id);
    if (!/^[0-9a-f-]{36}$/i.test(tenantId)) throw new HttpError(404, 'business_not_found');
    if (!env.SUPERADMIN_DATABASE_URL || !env.DATABASE_ADMIN_URL) throw new HttpError(503, 'provisioning_not_configured');
    const options = { ssl: env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined };
    let registry: pg.Client | undefined;
    try {
      registry = await connectClientWithRetry(env.SUPERADMIN_DATABASE_URL, options);
      const result = await registry.query(
        'SELECT domain, is_verified, is_primary FROM public.business_domains WHERE tenant_id = $1 ORDER BY is_primary DESC, domain',
        [tenantId],
      );
      return { domains: result.rows };
    } finally {
      if (registry) await registry.end().catch(() => {});
    }
  });

  app.post('/businesses/:id/domains', async (req, reply) => {
    const tenantId = String((req.params as { id: string }).id);
    if (!/^[0-9a-f-]{36}$/i.test(tenantId)) throw new HttpError(404, 'business_not_found');
    const { domain: rawDomain } = DomainInput.parse(req.body);
    const domain = requireDomain(rawDomain);
    if (!env.SUPERADMIN_DATABASE_URL || !env.DATABASE_ADMIN_URL) throw new HttpError(503, 'provisioning_not_configured');
    const options = { ssl: env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined };
    let registry: pg.Client | undefined;
    let tenant: pg.Client | undefined;
    let insertedRegistry = false;
    try {
      registry = await connectClientWithRetry(env.SUPERADMIN_DATABASE_URL, options);
      const databaseName = await getTenantDatabase(registry, tenantId);
      const business = await registry.query('SELECT id FROM public.businesses WHERE id = $1', [tenantId]);
      if (!business.rowCount) throw new HttpError(404, 'business_not_found');
      const existingRegistry = await registry.query(
        'SELECT tenant_id, is_verified FROM public.business_domains WHERE domain = $1',
        [domain],
      );
      if (existingRegistry.rowCount && existingRegistry.rows[0].tenant_id !== tenantId) {
        throw new HttpError(409, 'domain_already_registered');
      }

      tenant = await connectClientWithRetry(databaseUrl(env.DATABASE_ADMIN_URL, databaseName), options);
      const existingTenant = await tenant.query(
        'SELECT tenant_id FROM public.business_domains WHERE domain = $1',
        [domain],
      );
      if (existingTenant.rowCount && existingTenant.rows[0].tenant_id !== tenantId) {
        throw new HttpError(409, 'domain_already_registered');
      }

      // The central registry is authoritative. Re-running registration repairs a
      // partial prior write instead of getting stuck on a duplicate-key error.
      const verified = Boolean(existingRegistry.rows[0]?.is_verified);
      if (!existingRegistry.rowCount) {
        await registry.query(
          'INSERT INTO public.business_domains (tenant_id, domain, is_verified, is_primary) VALUES ($1, $2, false, false)',
          [tenantId, domain],
        );
        insertedRegistry = true;
      }
      if (!existingTenant.rowCount) {
        await tenant.query(
          'INSERT INTO public.business_domains (tenant_id, domain, is_verified, is_primary) VALUES ($1, $2, $3, false)',
          [tenantId, domain, verified],
        );
      } else {
        await tenant.query(
          'UPDATE public.business_domains SET is_verified = $3 WHERE tenant_id = $1 AND domain = $2',
          [tenantId, domain, verified],
        );
      }
      return reply.code(existingRegistry.rowCount && existingTenant.rowCount ? 200 : 201).send({
        domain,
        verified,
        verification: {
          type: 'TXT',
          name: `_torahtrainer-verification.${domain}`,
          value: `torahtrainer-verification=${tenantId}`,
        },
        next_step: verified
          ? 'DNS ownership is already verified. Connect the domain to Vercel and configure its DNS records.'
          : 'Add the TXT record, wait for DNS propagation, then call the verify endpoint.',
      });
    } catch (err) {
      if (insertedRegistry && registry) {
        await registry.query('DELETE FROM public.business_domains WHERE tenant_id = $1 AND domain = $2 AND NOT is_verified', [tenantId, domain]).catch(() => {});
      }
      if ((err as { code?: string }).code === '23505') throw new HttpError(409, 'domain_already_registered');
      if (err instanceof HttpError) throw err;
      req.log.error({ err }, 'custom domain registration failed');
      throw new HttpError(500, 'domain_registration_failed');
    } finally {
      if (tenant) await tenant.end().catch(() => {});
      if (registry) await registry.end().catch(() => {});
    }
  });

  app.post('/businesses/:id/domains/:domain/verify', async (req) => {
    const tenantId = String((req.params as { id: string }).id);
    const domain = requireDomain(decodeURIComponent(String((req.params as { domain: string }).domain)));
    if (!/^[0-9a-f-]{36}$/i.test(tenantId)) throw new HttpError(404, 'business_not_found');
    if (!env.SUPERADMIN_DATABASE_URL || !env.DATABASE_ADMIN_URL) throw new HttpError(503, 'provisioning_not_configured');
    const options = { ssl: env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined };
    let registry: pg.Client | undefined;
    let tenant: pg.Client | undefined;
    try {
      registry = await connectClientWithRetry(env.SUPERADMIN_DATABASE_URL, options);
      const databaseName = await getTenantDatabase(registry, tenantId);
      const domainRow = await registry.query(
        'SELECT id FROM public.business_domains WHERE tenant_id = $1 AND domain = $2',
        [tenantId, domain],
      );
      if (!domainRow.rowCount) throw new HttpError(404, 'domain_not_registered');
      if (!(await hasDomainVerification(domain, tenantId))) {
        throw new HttpError(409, 'dns_verification_not_found', 'TXT verification record was not found');
      }
      tenant = await connectClientWithRetry(databaseUrl(env.DATABASE_ADMIN_URL, databaseName), options);
      // Repair a missing tenant copy before enabling central routing. If the
      // central update fails, the domain remains unverified in the registry.
      const tenantUpdated = await tenant.query(
        'UPDATE public.business_domains SET is_verified = true WHERE tenant_id = $1 AND domain = $2 RETURNING domain',
        [tenantId, domain],
      );
      if (!tenantUpdated.rowCount) {
        await tenant.query(
          'INSERT INTO public.business_domains (tenant_id, domain, is_verified, is_primary) VALUES ($1, $2, true, false)',
          [tenantId, domain],
        );
      }
      await registry.query('UPDATE public.business_domains SET is_verified = true WHERE tenant_id = $1 AND domain = $2', [tenantId, domain]);
      return { domain, verified: true, note: 'DNS ownership verified. The domain still must be connected to the web hosting provider and pointed to its target.' };
    } finally {
      if (tenant) await tenant.end().catch(() => {});
      if (registry) await registry.end().catch(() => {});
    }
  });

  app.delete('/businesses/:id/domains/:domain', async (req, reply) => {
    const tenantId = String((req.params as { id: string }).id);
    const domain = requireDomain(decodeURIComponent(String((req.params as { domain: string }).domain)));
    if (!/^[0-9a-f-]{36}$/i.test(tenantId)) throw new HttpError(404, 'business_not_found');
    if (!env.SUPERADMIN_DATABASE_URL || !env.DATABASE_ADMIN_URL) throw new HttpError(503, 'provisioning_not_configured');
    const options = { ssl: env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined };
    let registry: pg.Client | undefined;
    let tenant: pg.Client | undefined;
    try {
      registry = await connectClientWithRetry(env.SUPERADMIN_DATABASE_URL, options);
      const databaseName = await getTenantDatabase(registry, tenantId);
      tenant = await connectClientWithRetry(databaseUrl(env.DATABASE_ADMIN_URL, databaseName), options);
      // Delete the tenant copy first. If the central delete fails, a retry can
      // still remove the registry row; doing this in the opposite order could
      // strand an unremovable tenant copy after the registry row disappeared.
      const tenantResult = await tenant.query(
        'DELETE FROM public.business_domains WHERE tenant_id = $1 AND domain = $2 RETURNING domain',
        [tenantId, domain],
      );
      const registryResult = await registry.query(
        'DELETE FROM public.business_domains WHERE tenant_id = $1 AND domain = $2 RETURNING domain',
        [tenantId, domain],
      );
      if (!tenantResult.rowCount && !registryResult.rowCount) throw new HttpError(404, 'domain_not_registered');
      return reply.code(204).send();
    } finally {
      if (tenant) await tenant.end().catch(() => {});
      if (registry) await registry.end().catch(() => {});
    }
  });

};
