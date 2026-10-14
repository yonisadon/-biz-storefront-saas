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
    const registry = new pg.Client({ connectionString: env.SUPERADMIN_DATABASE_URL, ...clientOptions });
    const databaseAdmin = new pg.Client({ connectionString: env.DATABASE_ADMIN_URL, ...clientOptions });
    let tenantAdmin: pg.Client | undefined;
    let tenantId: string | undefined;
    let databaseName: string | undefined;
    let databaseCreated = false;

    try {
      await registry.connect();
      await databaseAdmin.connect();

      // This function lives in the existing registry DB and enforces unique slugs.
      const created = await registry.query(
        'SELECT app.create_business($1, $2, $3, $4::jsonb) AS id',
        [
          input.slug,
          input.name,
          whatsappNumber,
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
        'UPDATE public.businesses SET phone = $2, email = $3 WHERE id = $1',
        [tenantId, phoneNumber, input.email || null],
      );

      // Database identifiers are generated from the server-created UUID, never user input.
      databaseName = `biz_${tenantId.replace(/-/g, '').slice(0, 24)}`;
      await databaseAdmin.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
      databaseCreated = true;

      tenantAdmin = new pg.Client({
        connectionString: databaseUrl(env.DATABASE_ADMIN_URL, databaseName),
        ...clientOptions,
      });
      await tenantAdmin.connect();

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
      if (databaseCreated && databaseName) {
        await databaseAdmin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)} WITH (FORCE)`).catch(() => {});
      }
      if (tenantId) {
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
      await databaseAdmin.end().catch(() => {});
      await registry.end().catch(() => {});
    }
  });
};
