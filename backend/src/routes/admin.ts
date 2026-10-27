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
  }).strict() }).optional(),
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

export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', async (req) => {
    if (!env.SUPERADMIN_API_TOKEN) throw new HttpError(503, 'admin_not_configured');
    if (!authorized(req)) throw new HttpError(401, 'unauthorized');
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
        `SELECT b.id, b.name, b.slug, b.status,
                COALESCE(json_agg(json_build_object('domain', d.domain, 'is_verified', d.is_verified, 'is_primary', d.is_primary)
                  ORDER BY d.is_primary DESC, d.domain) FILTER (WHERE d.id IS NOT NULL), '[]'::json) AS domains
           FROM public.businesses b
           JOIN app.tenant_databases td ON td.tenant_id = b.id
           LEFT JOIN public.business_domains d ON d.tenant_id = b.id
          GROUP BY b.id, b.name, b.slug, b.status
          ORDER BY b.created_at DESC`,
      );
      return { businesses: result.rows };
    } finally {
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
