import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { withTenant } from '../db';
import { HttpError } from '../errors';
import { normalizeILPhone } from '../util';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const phone = z.string().trim().min(1).max(40).transform((value, ctx) => {
  const normalized = normalizeILPhone(value);
  if (!normalized) {
    ctx.addIssue({ code: 'custom', message: 'invalid_il_phone' });
    return z.NEVER;
  }
  return normalized;
});

const PublicWaitlistInput = z.object({
  customer_name: z.string().trim().min(1).max(100),
  customer_phone: phone,
  service_ids: z.array(z.string().uuid()).min(1).max(20).refine((ids) => new Set(ids).size === ids.length, { message: 'duplicate_service_id' }),
  preferred_date: date,
  preferred_time_from: time.optional(),
  preferred_time_to: time.optional(),
  note: z.string().trim().max(500).optional(),
  company_website: z.string().max(0).optional(),
}).strict().refine((value) =>
  (value.preferred_time_from === undefined) === (value.preferred_time_to === undefined),
{ message: 'time_range_must_be_complete' }).refine((value) =>
  !value.preferred_time_from || value.preferred_time_to! > value.preferred_time_from,
{ message: 'invalid_time_range' });

const WaitlistStatus = z.enum(['waiting', 'contacted', 'scheduled', 'closed', 'cancelled']);

function idFrom(req: { params: unknown }): string {
  const id = (req.params as { id: string }).id;
  if (!UUID_RE.test(id)) throw new HttpError(404, 'not_found');
  return id;
}

export const publicWaitlistRoutes: FastifyPluginAsync = async (app) => {
  app.post('/waitlist', {
    config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
  }, async (req, reply) => {
    const input = PublicWaitlistInput.parse(req.body);
    try {
      const result = await withTenant(req.tenantId, async (db) => {
        const business = (await db.query(
          'SELECT timezone, (now() AT TIME ZONE timezone)::date::text AS today FROM businesses WHERE id = app.current_tenant_id()',
        )).rows[0];
        if (!business) throw new HttpError(404, 'not_found');
        if (input.preferred_date < business.today) throw new HttpError(400, 'preferred_date_in_past');
        const services = (await db.query(
          `SELECT id, name, kind,
                  COALESCE(booking_mode, CASE WHEN requires_appointment THEN 'free_datetime' ELSE 'none' END) AS booking_mode
             FROM products
            WHERE id = ANY($1::uuid[]) AND is_active = true\n            ORDER BY id`,
          [input.service_ids],
        )).rows;
        if (services.length !== input.service_ids.length ||
            services.some((service) => service.kind !== 'service' || service.booking_mode !== 'availability')) {
          throw new HttpError(400, 'invalid_waitlist_services');
        }
        return (await db.query(
          `INSERT INTO waitlist_entries
            (tenant_id, customer_name, customer_phone, service_ids, service_names, preferred_date,
             preferred_time_from, preferred_time_to, note)
           VALUES (app.current_tenant_id(), $1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id, created_at`,
          [
            input.customer_name, input.customer_phone, services.map((service) => service.id),
            services.map((service) => service.name), input.preferred_date,
            input.preferred_time_from ?? null, input.preferred_time_to ?? null,
            input.note || null,
          ],
        )).rows[0];
      });
      return reply.code(201).send({ id: result.id, created_at: result.created_at, message: 'waitlist_request_received' });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new HttpError(409, 'duplicate_waitlist_request', 'כבר קיימת בקשה פעילה עם אותם פרטים.');
      }
      throw error;
    }
  });
};

export const manageWaitlistRoutes: FastifyPluginAsync = async (app) => {
  app.get('/waitlist', async (req) => {
    const query = z.object({
      status: WaitlistStatus.optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
      offset: z.coerce.number().int().min(0).max(10000).default(0),
    }).parse(req.query);
    return withTenant(req.tenantId, async (db) => {
      const result = await db.query(
        `SELECT id, customer_name, customer_phone, service_ids, service_names, preferred_date,
                preferred_time_from, preferred_time_to, note, status, created_at, updated_at,
                count(*) OVER()::int AS total
           FROM waitlist_entries
          WHERE ($1::text IS NULL OR status = $1)
          ORDER BY created_at DESC, id DESC
          LIMIT $2 OFFSET $3`,
        [query.status ?? null, query.limit, query.offset],
      );
      return {
        total: result.rows[0] ? Number(result.rows[0].total) : 0,
        limit: query.limit,
        offset: query.offset,
        entries: result.rows.map(({ total: _total, ...entry }) => entry),
      };
    });
  });

  app.patch('/waitlist/:id', async (req) => {
    const id = idFrom(req);
    const input = z.object({ status: WaitlistStatus }).strict().parse(req.body);
    return withTenant(req.tenantId, async (db) => {
      const result = await db.query(
        'UPDATE waitlist_entries SET status = $1, updated_at = now() WHERE id = $2 RETURNING id, status, updated_at',
        [input.status, id],
      );
      if (!result.rows[0]) throw new HttpError(404, 'not_found');
      return result.rows[0];
    });
  });

  app.delete('/waitlist/:id', async (req, reply) => {
    const id = idFrom(req);
    return withTenant(req.tenantId, async (db) => {
      const result = await db.query('DELETE FROM waitlist_entries WHERE id = $1 RETURNING id', [id]);
      if (!result.rowCount) throw new HttpError(404, 'not_found');
      return reply.code(204).send();
    });
  });
};
