import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import pg from 'pg';
import { z } from 'zod';
import { env } from '../config';
import { HttpError } from '../errors';
import { normalizeILPhone } from '../util';

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
      const schema = readFileSync(join(__dirname, '../../migrations/tenant-schema.sql'), 'utf8');
      await tenantAdmin.query(schema);

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
};
