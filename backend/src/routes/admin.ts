import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveTxt } from 'node:dns/promises';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import pg from 'pg';
import sharp from 'sharp';
import { z } from 'zod';
import { env } from '../config';
import { HttpError } from '../errors';
import { normalizeILPhone } from '../util';
import { applyTenantMigrations } from '../tenantMigrations';
import { ensureCrmRetentionPolicy } from '../crmRetention';
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

const ExecuteDeletionInput = z.object({
  backupVerified: z.literal(true),
  backupReference: z.string().trim().min(8).max(500),
}).strict();

const DomainInput = z.object({
  domain: z.string().trim().min(4).max(253),
}).strict();


const PLATFORM_MEDIA_NAMESPACE = '00000000-0000-4000-8000-000000000001';

const PlatformMarketingContentInput = z.object({
  heroEyebrow: z.string().trim().max(100),
  heroTitle: z.string().trim().min(5).max(180),
  heroDescription: z.string().trim().min(10).max(700),
  announcementEnabled: z.boolean(),
  announcementTitle: z.string().trim().max(100),
  announcementBody: z.string().trim().max(500),
  heroImageUrl: z.string().url().max(2000).nullable(),
  screenshotUrls: z.array(z.string().url().max(2000)).max(4),
}).strict();

const OwnerDashboardContentInput = z.object({
  welcomeTitle: z.string().trim().max(120),
  welcomeMessage: z.string().trim().max(500),
}).strict();

const SendPlatformMessageInput = z.object({
  requestKey: z.string().uuid(),
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(5000),
  channel: z.enum(['in_app', 'email', 'both']),
  category: z.enum(['service', 'marketing']),
  audience: z.discriminatedUnion('type', [
    z.object({ type: z.literal('all') }).strict(),
    z.object({ type: z.literal('selected'), businessIds: z.array(z.string().uuid()).min(1).max(200) }).strict(),
  ]),
}).strict();

async function sendPlatformEmail(to: string, subject: string, body: string): Promise<{ messageId: string | null }> {
  if (!env.BREVO_API_KEY || !env.EMAIL_FROM) throw new HttpError(503, 'email_service_not_configured');
  const match = env.EMAIL_FROM.match(/^(?:(.*?)\\s*)?<([^<>]+)>$/);
  const senderEmail = match?.[2] ?? env.EMAIL_FROM;
  const senderName = match?.[1]?.trim() || 'BTime';
  const safeBody = body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const html = `<!doctype html><html lang="he" dir="rtl"><body dir="rtl" style="font-family:Arial,sans-serif;line-height:1.8;white-space:pre-line"><h2>${subject.replace(/[&<>]/g, '')}</h2><p>${safeBody.replace(/\\n/g, '<br>')}</p><p style="color:#777;font-size:12px">הודעה זו נשלחה ממערכת BTime.</p></body></html>`;
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({
      sender: { name: senderName, email: senderEmail },
      to: [{ email: to }],
      subject,
      htmlContent: html,
      textContent: body,
    }),
  });
  if (!response.ok) {
    console.error('BTime platform email was not accepted by provider', { status: response.status });
    throw new Error(`brevo_http_${response.status}`);
  }
  const result = await response.json().catch(() => null) as { messageId?: string } | null;
  return { messageId: result?.messageId ?? null };
}

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
  if (!env.SUPERADMIN_DATABASE_URL) return false;
  const raw = String(req.headers.cookie ?? '');
  const sessionCookie = raw.split(';').map((part) => part.trim()).find((part) => part.startsWith('btime_session='));
  let token = '';
  try {
    token = sessionCookie ? decodeURIComponent(sessionCookie.slice('btime_session='.length)) : '';
  } catch {
    return false;
  }
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
          AND u.role = 'super_admin' AND u.disabled_at IS NULL
        LIMIT 1`,
      [createHash('sha256').update(token, 'utf8').digest()],
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
    if (!env.SUPERADMIN_API_TOKEN && !env.SUPERADMIN_DATABASE_URL) throw new HttpError(503, 'admin_not_configured');
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
      await ensureCrmRetentionPolicy(tenantAdmin, tenantId);

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
                (u.email_verified_at IS NOT NULL) AS owner_email_verified,
                (SELECT dr.status FROM public.business_deletion_requests dr
                  WHERE dr.tenant_id = b.id ORDER BY dr.requested_at DESC LIMIT 1) AS deletion_request_status,
                COALESCE(json_agg(json_build_object('domain', d.domain, 'is_verified', d.is_verified, 'is_primary', d.is_primary)
                  ORDER BY d.is_primary DESC, d.domain) FILTER (WHERE d.id IS NOT NULL), '[]'::json) AS domains
           FROM public.businesses b
           JOIN app.tenant_databases td ON td.tenant_id = b.id
           LEFT JOIN public.business_domains d ON d.tenant_id = b.id
           LEFT JOIN public.platform_subscriptions s ON s.tenant_id = b.id
           LEFT JOIN public.platform_business_owners bo ON bo.tenant_id = b.id
           LEFT JOIN LATERAL (
             SELECT candidate.id
               FROM public.platform_users candidate
              WHERE NOT EXISTS (
                SELECT 1 FROM public.platform_business_owners existing_owner
                 WHERE existing_owner.user_id = candidate.id
              )
                AND lower(candidate.email) = lower(COALESCE(b.email, ''))
                AND (
                  SELECT count(*)
                    FROM public.platform_users possible
                   WHERE NOT EXISTS (
                     SELECT 1 FROM public.platform_business_owners linked_owner
                      WHERE linked_owner.user_id = possible.id
                   )
                     AND lower(possible.email) = lower(COALESCE(b.email, ''))
                ) = 1
              LIMIT 1
           ) candidate_owner ON bo.user_id IS NULL
           LEFT JOIN public.platform_users u ON u.id = COALESCE(bo.user_id, candidate_owner.id)
          GROUP BY b.id, s.status, s.trial_ends_at, s.current_period_ends_at, u.email, u.phone, u.email_verified_at
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
        "INSERT INTO public.platform_audit_log (actor_type, actor_email, action, tenant_id, metadata) VALUES ('super_admin', $2, 'business_status_changed', $1, $3::jsonb)",
        [tenantId, 'super_admin', JSON.stringify({ status: input.status, reason: input.reason ?? null })],
      );
      return updated.rows[0];
    } finally {
      if (tenant) await tenant.end().catch(() => {});
      if (registry) await registry.end().catch(() => {});
    }
  });

  app.patch('/businesses/:id/owner-email-verification', async (req) => {
    const tenantId = String((req.params as { id: string }).id);
    if (!/^[0-9a-f-]{36}$/i.test(tenantId)) throw new HttpError(404, 'business_not_found');
    if (!env.SUPERADMIN_DATABASE_URL) throw new HttpError(503, 'provisioning_not_configured');
    let registry: pg.Client | undefined;
    try {
      registry = await connectClientWithRetry(env.SUPERADMIN_DATABASE_URL, {
        ssl: env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
      });
      const owner = await registry.query(
        `SELECT u.id, u.email
           FROM public.businesses b
           LEFT JOIN public.platform_business_owners bo ON bo.tenant_id = b.id
           LEFT JOIN public.platform_users linked_owner ON linked_owner.id = bo.user_id
           LEFT JOIN LATERAL (
             SELECT candidate.id
               FROM public.platform_users candidate
              WHERE NOT EXISTS (
                SELECT 1 FROM public.platform_business_owners existing_owner
                 WHERE existing_owner.user_id = candidate.id
              )
                AND lower(candidate.email) = lower(COALESCE(b.email, ''))
                AND (
                  SELECT count(*)
                    FROM public.platform_users possible
                   WHERE NOT EXISTS (
                     SELECT 1 FROM public.platform_business_owners linked_owner_check
                      WHERE linked_owner_check.user_id = possible.id
                   )
                     AND lower(possible.email) = lower(COALESCE(b.email, ''))
                ) = 1
              LIMIT 1
           ) candidate_owner ON bo.user_id IS NULL
           JOIN public.platform_users u ON u.id = COALESCE(linked_owner.id, candidate_owner.id)
          WHERE b.id = $1
          LIMIT 1`,
        [tenantId],
      );
      if (!owner.rows[0]) throw new HttpError(404, 'business_owner_not_found_or_ambiguous');
      await registry.query(
        'INSERT INTO public.platform_business_owners (user_id, tenant_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [owner.rows[0].id, tenantId],
      );
      await registry.query(
        `UPDATE public.platform_users SET email_verified_at = COALESCE(email_verified_at, now()), updated_at = now() WHERE id = $1`,
        [owner.rows[0].id],
      );
      await registry.query(
        `UPDATE public.platform_email_tokens SET consumed_at = now()
         WHERE user_id = $1 AND purpose = 'verify_email' AND consumed_at IS NULL`,
        [owner.rows[0].id],
      );
      await registry.query(
        "INSERT INTO public.platform_audit_log (actor_type, actor_email, action, tenant_id, metadata) VALUES ('super_admin', 'super_admin', 'owner_email_verified_manually', $1, $2::jsonb)",
        [tenantId, JSON.stringify({ owner_email: owner.rows[0].email })],
      );
      return { tenant_id: tenantId, owner_email_verified: true };
    } finally {
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
        "INSERT INTO public.platform_audit_log (actor_type, actor_email, action, tenant_id, metadata) VALUES ('super_admin', $2, 'subscription_status_changed', $1, $3::jsonb)",
        [tenantId, 'super_admin', JSON.stringify({ status: input.status })],
      );
      return result.rows[0];
    } finally {
      if (registry) await registry.end().catch(() => {});
    }
  });

  app.post('/businesses/:id/deletion-request', async (req, reply) => {
    const tenantId = String((req.params as { id: string }).id);
    if (!/^[0-9a-f-]{36}$/i.test(tenantId)) throw new HttpError(404, 'business_not_found');
    if (!env.SUPERADMIN_DATABASE_URL) throw new HttpError(503, 'provisioning_not_configured');
    const registry = await connectClientWithRetry(env.SUPERADMIN_DATABASE_URL, {
      ssl: env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    });
    try {
      const business = await registry.query(
        `SELECT b.id, b.name, b.slug
           FROM public.businesses b
           JOIN app.tenant_databases td ON td.tenant_id = b.id
          WHERE b.id = $1
          LIMIT 1`,
        [tenantId],
      );
      if (!business.rows[0]) throw new HttpError(404, 'business_not_found');
      const b = business.rows[0];
      const inserted = await registry.query(
        `INSERT INTO public.business_deletion_requests
           (tenant_id, business_name, business_slug, requested_by_admin, reason)
         VALUES ($1, $2, $3, true, 'מחיקה ביוזמת סופר אדמין')
         ON CONFLICT (tenant_id) WHERE status = 'pending' DO NOTHING
         RETURNING id, status, requested_at`,
        [tenantId, b.name, b.slug],
      );
      const request = inserted.rows[0] ?? (await registry.query(
        "SELECT id, status, requested_at FROM public.business_deletion_requests WHERE tenant_id = $1 AND status = 'pending' LIMIT 1",
        [tenantId],
      )).rows[0];
      if (inserted.rowCount) {
        await registry.query(
          "INSERT INTO public.platform_audit_log (actor_type, actor_email, action, tenant_id, metadata) VALUES ('super_admin', 'super_admin', 'business_deletion_requested_by_admin', $1, $2::jsonb)",
          [tenantId, JSON.stringify({ request_id: request.id, business_name: b.name, business_slug: b.slug })],
        );
      }
      return reply.code(inserted.rowCount ? 201 : 200).send({
        request,
        message: inserted.rowCount ? 'בקשת המחיקה נוצרה. יש לאשר ולהקפיא את העסק לפני מחיקה מלאה.' : 'כבר קיימת בקשת מחיקה פתוחה לעסק.',
      });
    } finally {
      await registry.end().catch(() => {});
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
                dr.database_name, COALESCE(u.email, CASE WHEN dr.requested_by_admin THEN 'סופר אדמין' END) AS owner_email,
                u.phone AS owner_phone
           FROM public.business_deletion_requests dr
           LEFT JOIN public.businesses b ON b.id = dr.tenant_id
           LEFT JOIN public.platform_users u ON u.id = dr.requested_by_user_id
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
            SET status = $2, reviewed_at = now(), reviewed_by_email = $4, review_note = $3
          WHERE id = $1 AND status = 'pending'
          RETURNING id, tenant_id, status`,
        [requestId, input.decision === 'approve' ? 'approved' : 'rejected', input.note ?? null, 'super_admin'],
      );
      if (!result.rows[0]) throw new HttpError(404, 'deletion_request_not_found');
      if (input.decision === 'approve') {
        await registry.query("UPDATE public.businesses SET status = 'suspended' WHERE id = $1", [result.rows[0].tenant_id]);
      }
      await registry.query(
        "INSERT INTO public.platform_audit_log (actor_type, actor_email, action, tenant_id, metadata) VALUES ('super_admin', $2, 'business_deletion_reviewed', $1, $3::jsonb)",
        [result.rows[0].tenant_id, 'super_admin', JSON.stringify({ decision: input.decision, note: input.note ?? null })],
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
    const backupInput = ExecuteDeletionInput.parse(req.body);

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

      // Destructive deletion is blocked unless an operator explicitly attests that
      // a Railway backup was created and its restore/readability was verified.
      const backupRecorded = await registry.query(
        'UPDATE public.business_deletion_requests SET backup_verified_at = now(), backup_reference = $2, backup_verified_by = $3 WHERE id = $1 AND status = \'approved\' RETURNING id',
        [requestId, backupInput.backupReference, 'super_admin'],
      );
      if (!backupRecorded.rowCount) throw new HttpError(409, 'deletion_request_not_approved');
      await registry.query(
        "INSERT INTO public.platform_audit_log (actor_type, actor_email, action, metadata) VALUES ('super_admin', 'super_admin', 'business_deletion_backup_verified', $1::jsonb)",
        [JSON.stringify({ deletion_request_id: requestId, backup_reference: backupInput.backupReference })],
      );

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

      for (let offset = 0; offset < storageKeys.length; offset += 1000) {
        await storage.remove(storageKeys.slice(offset, offset + 1000));
      }
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
          "INSERT INTO public.platform_audit_log (actor_type, actor_email, action, metadata) VALUES ('super_admin', $1, 'business_deleted', $2::jsonb)",
          ['super_admin', JSON.stringify({ deletion_request_id: requestId, business_name: request.business_name, business_slug: request.business_slug, database_name: databaseName })],
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


  // ---- Platform-owned marketing content and owner communications ----
  app.get('/platform-content/:key', async (req) => {
    const key = String((req.params as { key: string }).key);
    if (!['marketing_page', 'owner_dashboard'].includes(key)) throw new HttpError(404, 'platform_content_not_found');
    if (!env.SUPERADMIN_DATABASE_URL) throw new HttpError(503, 'admin_not_configured');
    let registry: pg.Client | undefined;
    try {
      registry = await connectClientWithRetry(env.SUPERADMIN_DATABASE_URL, {
        ssl: env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
      });
      const result = await registry.query(
        'SELECT content, updated_at FROM public.platform_content WHERE content_key = $1',
        [key],
      );
      return { content: result.rows[0]?.content ?? null, updated_at: result.rows[0]?.updated_at ?? null };
    } finally {
      if (registry) await registry.end().catch(() => {});
    }
  });

  app.put('/platform-content/:key', async (req) => {
    const key = String((req.params as { key: string }).key);
    if (!['marketing_page', 'owner_dashboard'].includes(key)) throw new HttpError(404, 'platform_content_not_found');
    const content = key === 'marketing_page'
      ? PlatformMarketingContentInput.parse(req.body)
      : OwnerDashboardContentInput.parse(req.body);
    if (!env.SUPERADMIN_DATABASE_URL) throw new HttpError(503, 'admin_not_configured');
    let registry: pg.Client | undefined;
    try {
      registry = await connectClientWithRetry(env.SUPERADMIN_DATABASE_URL, {
        ssl: env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
      });
      const result = await registry.query(
        `INSERT INTO public.platform_content (content_key, content, updated_at)
         VALUES ($1, $2::jsonb, now())
         ON CONFLICT (content_key) DO UPDATE
           SET content = EXCLUDED.content, updated_at = now()
         RETURNING content, updated_at`,
        [key, JSON.stringify(content)],
      );
      return { content: result.rows[0].content, updated_at: result.rows[0].updated_at };
    } finally {
      if (registry) await registry.end().catch(() => {});
    }
  });

  app.post('/platform-media', async (req, reply) => {
    const file = await req.file();
    if (!file) throw new HttpError(400, 'image_required');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      throw new HttpError(415, 'unsupported_image_type');
    }
    const source = await file.toBuffer();
    if (source.length > 8 * 1024 * 1024) throw new HttpError(413, 'image_too_large');
    let output: Buffer;
    try {
      const metadata = await sharp(source, { limitInputPixels: 40_000_000 }).metadata();
      if (!metadata.format || !['jpeg', 'png', 'webp'].includes(metadata.format)) throw new Error('unsupported');
      output = await sharp(source, { limitInputPixels: 40_000_000 })
        .rotate()
        .resize({ width: 2200, height: 1600, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 86, mozjpeg: true })
        .toBuffer();
    } catch {
      throw new HttpError(400, 'invalid_image');
    }
    const assetId = randomUUID();
    const key = `${PLATFORM_MEDIA_NAMESPACE}/${assetId}.jpg`;
    await storage.put(key, output, 'image/jpeg');
    const base = env.MEDIA_BASE_URL.replace(/\\/+$/, '');
    return reply.code(201).send({
      url: `${base}/media/${PLATFORM_MEDIA_NAMESPACE}/${assetId}.jpg`,
      content_type: 'image/jpeg',
      size_bytes: output.length,
    });
  });

  app.get('/messages', async () => {
    if (!env.SUPERADMIN_DATABASE_URL) throw new HttpError(503, 'admin_not_configured');
    let registry: pg.Client | undefined;
    try {
      registry = await connectClientWithRetry(env.SUPERADMIN_DATABASE_URL, {
        ssl: env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
      });
      const result = await registry.query(
        `SELECT m.id, m.title, m.body, m.channel, m.category, m.audience, m.status, m.created_at, m.completed_at,
                count(r.id)::int AS recipient_count,
                count(r.id) FILTER (WHERE r.email_status = 'accepted')::int AS email_accepted_count,
                count(r.id) FILTER (WHERE r.email_status = 'failed')::int AS email_failed_count,
                count(r.id) FILTER (WHERE r.email_status = 'skipped_consent')::int AS email_skipped_count,
                count(r.id) FILTER (WHERE r.in_app_read_at IS NOT NULL)::int AS in_app_read_count
           FROM public.platform_messages m
           LEFT JOIN public.platform_message_recipients r ON r.message_id = m.id
          GROUP BY m.id
          ORDER BY m.created_at DESC
          LIMIT 50`,
      );
      return { messages: result.rows };
    } finally {
      if (registry) await registry.end().catch(() => {});
    }
  });

  app.post('/messages', async (req, reply) => {
    const input = SendPlatformMessageInput.parse(req.body);
    if (!env.SUPERADMIN_DATABASE_URL) throw new HttpError(503, 'admin_not_configured');
    if (input.channel !== 'in_app' && (!env.BREVO_API_KEY || !env.EMAIL_FROM)) {
      throw new HttpError(503, 'email_service_not_configured');
    }
    let registry: pg.Client | undefined;
    let messageId: string | undefined;
    try {
      registry = await connectClientWithRetry(env.SUPERADMIN_DATABASE_URL, {
        ssl: env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
      });
      await registry.query('BEGIN');
      try {
        const inserted = await registry.query(
          `INSERT INTO public.platform_messages (request_key, title, body, channel, category, audience, status)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'queued')
           ON CONFLICT (request_key) DO NOTHING
           RETURNING id`,
          [input.requestKey, input.title, input.body, input.channel, input.category, JSON.stringify(input.audience)],
        );
        messageId = inserted.rows[0]?.id as string | undefined;
        if (!messageId) throw new HttpError(409, 'duplicate_message_submission');
        const recipients = await registry.query(
          `SELECT u.id AS user_id, bo.tenant_id, u.email,
                  COALESCE(consent.granted, false) AS marketing_email
             FROM public.platform_users u
             LEFT JOIN public.platform_business_owners bo ON bo.user_id = u.id
             LEFT JOIN LATERAL (
               SELECT granted FROM public.platform_user_consents
                WHERE user_id = u.id AND consent_type = 'marketing_email'
                ORDER BY recorded_at DESC LIMIT 1
             ) consent ON true
            WHERE u.role = 'owner' AND u.disabled_at IS NULL
              AND ($1::boolean OR bo.tenant_id = ANY($2::uuid[]))
            ORDER BY u.created_at ASC`,
          [input.audience.type === 'all', input.audience.type === 'selected' ? input.audience.businessIds : []],
        );
        if (!recipients.rowCount) throw new HttpError(404, 'no_message_recipients');
        for (const recipient of recipients.rows) {
          const wantsEmail = input.channel === 'email' || input.channel === 'both';
          const consented = input.category === 'service' || recipient.marketing_email === true;
          const emailStatus = !wantsEmail ? 'not_requested' : !recipient.email || !consented ? 'skipped_consent' : 'pending';
          await registry.query(
            `INSERT INTO public.platform_message_recipients
              (message_id, user_id, tenant_id, email_address, email_status)
             VALUES ($1, $2, $3, $4, $5)`,
            [messageId, recipient.user_id, recipient.tenant_id, recipient.email, emailStatus],
          );
        }
        await registry.query('UPDATE public.platform_messages SET status = $2 WHERE id = $1', [messageId, 'sending']);
        await registry.query('COMMIT');
      } catch (error) {
        await registry.query('ROLLBACK').catch(() => {});
        throw error;
      }

      const pending = await registry.query(
        `SELECT r.id, r.email_address
           FROM public.platform_message_recipients r
          WHERE r.message_id = $1 AND r.email_status = 'pending'
          ORDER BY r.created_at ASC`,
        [messageId],
      );
      for (const recipient of pending.rows) {
        try {
          const result = await sendPlatformEmail(recipient.email_address, input.title, input.body);
          await registry.query(
            `UPDATE public.platform_message_recipients
                SET email_status = 'accepted', email_provider_message_id = $2, email_accepted_at = now(), email_error = NULL
              WHERE id = $1`,
            [recipient.id, result.messageId],
          );
        } catch (error) {
          const reason = error instanceof Error ? error.message.slice(0, 500) : 'provider_error';
          await registry.query(
            `UPDATE public.platform_message_recipients
                SET email_status = 'failed', email_error = $2
              WHERE id = $1`,
            [recipient.id, reason],
          );
        }
      }
      const counts = await registry.query(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE email_status = 'accepted')::int AS accepted,
                count(*) FILTER (WHERE email_status = 'failed')::int AS failed,
                count(*) FILTER (WHERE email_status = 'pending')::int AS pending
           FROM public.platform_message_recipients WHERE message_id = $1`,
        [messageId],
      );
      const summary = counts.rows[0];
      const status = summary.failed > 0 ? (summary.accepted > 0 ? 'partial' : 'failed') : 'accepted';
      await registry.query(
        'UPDATE public.platform_messages SET status = $2, completed_at = now() WHERE id = $1',
        [messageId, status],
      );
      return reply.code(201).send({
        id: messageId,
        status,
        recipient_count: summary.total,
        email_accepted_count: summary.accepted,
        email_failed_count: summary.failed,
        email_pending_count: summary.pending,
        note: 'accepted means the provider accepted the email request; it does not confirm delivery or opening.',
      });
    } finally {
      if (registry) await registry.end().catch(() => {});
    }
  });

};
