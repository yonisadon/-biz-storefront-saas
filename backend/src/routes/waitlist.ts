import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { withTenant } from '../db';
import { HttpError } from '../errors';
import { normalizeILPhone } from '../util';
import { validateAppointmentSelection } from '../appointmentRules';
import { processGoogleCalendarJobs } from '../googleCalendarService';
import { hasUniqueServiceIds, isValidCalendarDate, isValidWaitlistTimeRange } from '../waitlistRules';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const date = z.string().refine(isValidCalendarDate, { message: 'invalid_date' });
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
  customer_name: z.string().trim().max(100).optional(),
  customer_phone: phone,
  service_ids: z.array(z.string().uuid()).min(1).max(20).refine(hasUniqueServiceIds, { message: 'duplicate_service_id' }),
  preferred_date: date,
  preferred_time_from: time.optional(),
  preferred_time_to: time.optional(),
  note: z.string().trim().max(500).optional(),
  company_website: z.string().max(0).optional(),
}).strict().refine((value) =>
  isValidWaitlistTimeRange(value.preferred_time_from, value.preferred_time_to),
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
            WHERE id = ANY($1::uuid[]) AND is_active = true
            ORDER BY id`,
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
            input.customer_name || null, input.customer_phone, services.map((service) => service.id),
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
        `SELECT w.id, w.customer_name, w.customer_phone, w.service_ids, w.service_names, w.preferred_date,
                w.preferred_time_from, w.preferred_time_to, w.note, w.status, w.created_at, w.updated_at,
                w.appointment_id, a.start_at AS appointment_start_at,
                count(*) OVER()::int AS total
           FROM waitlist_entries w
           LEFT JOIN appointments a ON a.id = w.appointment_id AND a.tenant_id = w.tenant_id
          WHERE ($1::text IS NULL OR w.status = $1)
          ORDER BY w.created_at DESC, w.id DESC
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
    const input = z.object({ status: z.enum(['waiting', 'contacted', 'closed', 'cancelled']) }).strict().parse(req.body);
    return withTenant(req.tenantId, async (db) => {
      const current = (await db.query(
        'SELECT appointment_id FROM waitlist_entries WHERE id = $1 FOR UPDATE',
        [id],
      )).rows[0];
      if (!current) throw new HttpError(404, 'not_found');
      if (current.appointment_id && (input.status === 'waiting' || input.status === 'contacted')) {
        throw new HttpError(409, 'waitlist_has_scheduled_appointment', 'יש לעדכן או לבטל את התור ביומן לפני פתיחת הבקשה מחדש.');
      }
      if (current.appointment_id && (input.status === 'closed' || input.status === 'cancelled')) {
        await db.query(
          "UPDATE appointments SET status = 'cancelled' WHERE id = $1 AND status = 'reserved'",
          [current.appointment_id],
        );
      }
      const result = await db.query(
        'UPDATE waitlist_entries SET status = $1, updated_at = now() WHERE id = $2 RETURNING id, status, appointment_id, updated_at',
        [input.status, id],
      );
      return result.rows[0];
    });
  });

  app.post('/waitlist/:id/schedule', async (req, reply) => {
    const id = idFrom(req);
    const input = z.object({
      start_at: z.string().regex(/^\\d{4}-\\d{2}-\\d{2}T(?:[01]\\d|2[0-3]):[0-5]\\d$/),
    }).strict().parse(req.body);
    if (!isValidCalendarDate(input.start_at.slice(0, 10))) throw new HttpError(400, 'invalid_appointment_time');

    try {
      const result = await withTenant(req.tenantId, async (db) => {
        const entry = (await db.query(
          'SELECT * FROM waitlist_entries WHERE id = $1 FOR UPDATE',
          [id],
        )).rows[0];
        if (!entry) throw new HttpError(404, 'not_found');
        if (entry.appointment_id || entry.status === 'scheduled') {
          throw new HttpError(409, 'waitlist_already_scheduled', 'כבר קיים תור המשויך לבקשה זו.');
        }
        if (entry.status === 'closed' || entry.status === 'cancelled') {
          throw new HttpError(409, 'waitlist_not_active', 'לא ניתן לשבץ בקשה סגורה או מבוטלת.');
        }

        const business = (await db.query(
          'SELECT timezone, config FROM businesses WHERE id = app.current_tenant_id()',
        )).rows[0];
        if (!business) throw new HttpError(404, 'not_found');

        const services = (await db.query(
          `SELECT id, name, kind, booking_mode, requires_appointment, appointment_duration_minutes
             FROM products
            WHERE id = ANY($1::uuid[]) AND is_active = true
            ORDER BY id
            FOR SHARE`,
          [entry.service_ids],
        )).rows;
        if (services.length !== entry.service_ids.length ||
            services.some((service) => service.kind !== 'service' ||
              (service.booking_mode ?? (service.requires_appointment ? 'free_datetime' : 'none')) !== 'availability')) {
          throw new HttpError(409, 'waitlist_services_unavailable', 'אחד השירותים בבקשה אינו זמין עוד לשיבוץ.');
        }

        const duration = services.reduce(
          (sum, service) => sum + (service.appointment_duration_minutes ?? 30),
          0,
        );
        const validationError = validateAppointmentSelection({
          needsAppointment: true,
          appointmentAt: input.start_at,
          durationMinutes: duration,
          openingHoursDays: business.config?.opening_hours?.days,
          timezone: business.timezone,
        });
        if (validationError) throw new HttpError(400, validationError);

        const serviceNames = services.map((service) => service.name);
        const appointment = (await db.query(
          `INSERT INTO appointments
             (tenant_id, service_id, service_name, customer_phone, start_at, end_at, source, status)
           VALUES
             (app.current_tenant_id(), $1, $2, $3,
              ($4::timestamp AT TIME ZONE $5),
              (($4::timestamp AT TIME ZONE $5) + ($6::int * interval '1 minute')),
              'manual', 'reserved')
           RETURNING id, start_at, end_at, status`,
          [
            services.length === 1 ? services[0].id : null,
            serviceNames.join(' + '),
            entry.customer_phone,
            input.start_at,
            business.timezone,
            duration,
          ],
        )).rows[0];

        await db.query(
          "UPDATE waitlist_entries SET status = 'scheduled', appointment_id = $1, updated_at = now() WHERE id = $2",
          [appointment.id, id],
        );
        return { ...appointment, service_name: serviceNames.join(' + '), message: 'waitlist_scheduled' };
      });
      void processGoogleCalendarJobs(req.tenantId, 5).catch((error) =>
        req.log.warn({ err: error }, 'Google Calendar sync after waitlist scheduling failed'));
      return reply.code(201).send(result);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === '23P01' || code === '23505') {
        throw new HttpError(409, 'slot_taken', 'המועד כבר נתפס. בחרו שעה אחרת.');
      }
      throw error;
    }
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
