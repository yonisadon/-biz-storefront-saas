import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { withTenant } from '../db';
import { HttpError } from '../errors';
import { normalizeILPhone } from '../util';
import { validateAppointmentSelection } from '../appointmentRules';
import { processGoogleCalendarJobs } from '../googleCalendarService';
import { dispatchPushEventAfterCommit, enqueuePushEvent } from '../pushService';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/);
const phoneInput = z.string().trim().min(1).max(40).transform((value, ctx) => {
  const phone = normalizeILPhone(value);
  if (!phone) { ctx.addIssue({ code: 'custom', message: 'invalid_il_phone' }); return z.NEVER; }
  return phone;
});
const ManualAppointmentInput = z.object({
  service_id: z.string().uuid(),
  customer_phone: phoneInput,
  start_at: localDateTime,
}).strict();
const AppointmentPatchInput = z.object({
  service_id: z.string().uuid().optional(),
  customer_phone: phoneInput.optional(),
  start_at: localDateTime.optional(),
  status: z.enum(['reserved', 'cancelled']).optional(),
}).strict().refine((value) => Object.values(value).some((v) => v !== undefined), { message: 'empty_patch' });
const BlockInput = z.object({
  start_at: localDateTime,
  end_at: localDateTime,
  reason: z.string().trim().max(300).optional().transform((v) => v || null),
}).strict();

function idFrom(req: { params: unknown }): string {
  const id = (req.params as { id: string }).id;
  if (!UUID_RE.test(id)) throw new HttpError(404, 'not_found');
  return id;
}

function validateSlot(args: {
  startAt: string; duration: number; openingHours: unknown; timezone: string;
}) {
  const error = validateAppointmentSelection({
    needsAppointment: true,
    appointmentAt: args.startAt,
    durationMinutes: args.duration,
    openingHoursDays: args.openingHours as Record<string, unknown> | null,
    timezone: args.timezone,
  });
  if (error) throw new HttpError(400, error);
}

function slotConflict(error: unknown): never | void {
  const code = (error as { code?: string }).code;
  if (code === '23P01' || code === '23505') throw new HttpError(409, 'slot_taken', 'המועד כבר נתפס. בחרו שעה אחרת.');
}

export const appointmentRoutes: FastifyPluginAsync = async (app) => {
  // Calendar reads are read-only; retention cleanup runs only through the central scheduled worker.
  app.get('/appointments', async (req) => {
    const query = z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }).strict().refine((value) => Boolean(value.date) !== Boolean(value.from || value.to), { message: 'provide_date_or_range' })
      .refine((value) => !value.from || !value.to || value.from <= value.to, { message: 'invalid_date_range' })
      .parse(req.query);
    const from = query.date ?? query.from!;
    const to = query.date ?? query.to!;
    if (!query.date && (!query.from || !query.to)) throw new HttpError(400, 'invalid_date_range');
    return withTenant(req.tenantId, async (db) => {
      const biz = (await db.query('SELECT timezone FROM businesses WHERE id = app.current_tenant_id()')).rows[0];
      if (!biz) throw new HttpError(404, 'not_found');
      const appointments = (await db.query(
        `SELECT a.id, a.lead_id, a.service_id, a.service_name, a.customer_phone,
                to_char(a.start_at AT TIME ZONE $3, 'YYYY-MM-DD"T"HH24:MI') AS start_at,
                to_char(a.end_at AT TIME ZONE $3, 'YYYY-MM-DD"T"HH24:MI') AS end_at,
                a.source, a.status, a.created_at
           FROM appointments a
          WHERE a.start_at < (($2::date + interval '1 day')::timestamp AT TIME ZONE $3)
            AND a.end_at > ($1::date::timestamp AT TIME ZONE $3)
          ORDER BY a.start_at`,
        [from, to, biz.timezone],
      )).rows;
      const blocks = (await db.query(
        `SELECT id,
                to_char(start_at AT TIME ZONE $3, 'YYYY-MM-DD"T"HH24:MI') AS start_at,
                to_char(end_at AT TIME ZONE $3, 'YYYY-MM-DD"T"HH24:MI') AS end_at,
                reason
           FROM appointment_blocks
          WHERE start_at < (($2::date + interval '1 day')::timestamp AT TIME ZONE $3)
            AND end_at > ($1::date::timestamp AT TIME ZONE $3)
          ORDER BY start_at`,
        [from, to, biz.timezone],
      )).rows;
      return { date: from, from, to, timezone: biz.timezone, appointments, blocks };
    });
  });

  // Create an appointment manually from the seller calendar; it does not create a lead.
  app.post('/appointments', async (req, reply) => {
    const input = ManualAppointmentInput.parse(req.body);
    try {
      const appointment = await withTenant(req.tenantId, async (db) => {
        const biz = (await db.query(
          'SELECT timezone, config FROM businesses WHERE id = app.current_tenant_id()',
        )).rows[0];
        const service = (await db.query(
          `SELECT id, name, kind, appointment_duration_minutes
             FROM products WHERE id = $1 AND is_active = true FOR SHARE`,
          [input.service_id],
        )).rows[0];
        if (!biz) throw new HttpError(404, 'not_found');
        if (!service || service.kind !== 'service') throw new HttpError(400, 'invalid_service');
        const duration = service.appointment_duration_minutes ?? 30;
        validateSlot({ startAt: input.start_at, duration, openingHours: biz.config?.opening_hours?.days, timezone: biz.timezone });
        return (await db.query(
          `INSERT INTO appointments
             (tenant_id, service_id, service_name, customer_phone, start_at, end_at, source, status)
           VALUES
             (app.current_tenant_id(), $1, $2, $3,
              ($4::timestamp AT TIME ZONE $5),
              (($4::timestamp AT TIME ZONE $5) + ($6::int * interval '1 minute')),
              'manual', 'reserved')
           RETURNING id, service_id, service_name, customer_phone, start_at, end_at, source, status`,
          [service.id, service.name, input.customer_phone, input.start_at, biz.timezone, duration],
        )).rows[0];
      });
      void processGoogleCalendarJobs(req.tenantId, 5).catch((error) => req.log.warn({ err: error }, 'Google Calendar sync after appointment create failed'));
      return reply.code(201).send(appointment);
    } catch (error) { slotConflict(error); throw error; }
  });

  app.patch('/appointments/:id', async (req) => {
    const id = idFrom(req);
    const patch = AppointmentPatchInput.parse(req.body);
    try {
      const updateResult = await withTenant(req.tenantId, async (db) => {
        const current = (await db.query('SELECT * FROM appointments WHERE id = $1 FOR UPDATE', [id])).rows[0];
        if (!current) throw new HttpError(404, 'not_found');
        const biz = (await db.query(
          'SELECT timezone, config FROM businesses WHERE id = app.current_tenant_id()',
        )).rows[0];
        if (!biz) throw new HttpError(404, 'not_found');
        const serviceId = patch.service_id ?? current.service_id;
        const service = serviceId ? (await db.query(
          'SELECT id, name, kind, appointment_duration_minutes FROM products WHERE id = $1 AND is_active = true FOR SHARE',
          [serviceId],
        )).rows[0] : null;
        if ((!service || service.kind !== 'service') && patch.status === 'cancelled' && !patch.service_id && !patch.start_at) {
          const cancelled = await db.query(
            "UPDATE appointments SET status = 'cancelled', status_changed_at = now() WHERE id = $1 AND status IS DISTINCT FROM 'cancelled' RETURNING id, lead_id, service_id, service_name, customer_phone, start_at, end_at, source, status",
            [id],
          );
          await db.query("UPDATE waitlist_entries SET status = 'rejected', updated_at = now() WHERE appointment_id = $1", [id]);
          let pushEventId: string | null = null;
          if (cancelled.rows[0]) {
            const waitlist = await db.query('SELECT id FROM waitlist_entries WHERE appointment_id = $1 LIMIT 1', [id]);
            const eligible = current.source === 'website' || Boolean(waitlist.rows[0]);
            if (eligible) {
              const business = (await db.query('SELECT slug FROM businesses WHERE id = app.current_tenant_id()')).rows[0];
              pushEventId = await enqueuePushEvent(db, req.tenantId, {
                audience: 'customer', eventType: 'customer.appointment_cancelled',
                targetType: 'appointment', targetId: id,
                payload: { title: 'עדכון לגבי התור', body: 'העסק עדכן את מצב התור שלך', url: '/biz/' + business.slug },
              });
            }
          }
          return { appointment: cancelled.rows[0] ?? current, push_event_id: pushEventId };
        }
        const isMultiServiceAppointment = !service && current.service_id === null && !patch.service_id;
        if ((!service || service.kind !== 'service') && !isMultiServiceAppointment) throw new HttpError(400, 'invalid_service');
        const startAt = patch.start_at ?? (await db.query(
          'SELECT to_char($1::timestamptz AT TIME ZONE $2, \'YYYY-MM-DD"T"HH24:MI\') AS value',
          [current.start_at, biz.timezone],
        )).rows[0].value;
        const preservedDuration = Math.round((new Date(current.end_at).getTime() - new Date(current.start_at).getTime()) / 60_000);
        const duration = service?.appointment_duration_minutes ?? (isMultiServiceAppointment ? preservedDuration : 30);
        const serviceName = service?.name ?? current.service_name;
        const status = patch.status ?? current.status;
        if (status === 'reserved') validateSlot({
          startAt, duration, openingHours: biz.config?.opening_hours?.days, timezone: biz.timezone,
        });
        const oldStartAt = (await db.query(
          'SELECT to_char($1::timestamptz AT TIME ZONE $2, \'YYYY-MM-DD"T"HH24:MI\') AS value',
          [current.start_at, biz.timezone],
        )).rows[0].value as string;
        const nextPhone = patch.customer_phone ?? current.customer_phone;
        const nextServiceId = service?.id ?? null;
        const changed = nextServiceId !== current.service_id || serviceName !== current.service_name ||
          nextPhone !== current.customer_phone || startAt !== oldStartAt || status !== current.status;
        const updated = await db.query(
          'UPDATE appointments SET service_id = $1, service_name = $2, customer_phone = $3, status_changed_at = CASE WHEN status IS DISTINCT FROM $7 THEN now() ELSE status_changed_at END, ' +
          'start_at = ($4::timestamp AT TIME ZONE $5), ' +
          'end_at = (($4::timestamp AT TIME ZONE $5) + ($6::int * interval \'1 minute\')), ' +
          'status = $7 WHERE id = $8 ' +
          'RETURNING id, lead_id, service_id, service_name, customer_phone, start_at, end_at, source, status',
          [nextServiceId, serviceName, nextPhone, startAt, biz.timezone, duration, status, id],
        );
        if (status === 'cancelled') {
          await db.query("UPDATE waitlist_entries SET status = 'rejected', updated_at = now() WHERE appointment_id = $1", [id]);
        } else if (status === 'reserved') {
          await db.query("UPDATE waitlist_entries SET status = 'closed', updated_at = now() WHERE appointment_id = $1", [id]);
        }
        let pushEventId: string | null = null;
        if (changed) {
          const waitlist = await db.query('SELECT id FROM waitlist_entries WHERE appointment_id = $1 LIMIT 1', [id]);
          const eligible = current.source === 'website' || Boolean(waitlist.rows[0]);
          if (eligible) {
            const business = (await db.query('SELECT slug FROM businesses WHERE id = app.current_tenant_id()')).rows[0];
            pushEventId = await enqueuePushEvent(db, req.tenantId, {
              audience: 'customer',
              eventType: status === 'cancelled' ? 'customer.appointment_cancelled' : 'customer.appointment_updated',
              targetType: 'appointment',
              targetId: id,
              payload: {
                title: status === 'cancelled' ? 'עדכון לגבי התור' : 'התור שלך עודכן',
                body: status === 'cancelled' ? 'העסק עדכן את מצב התור שלך' : 'העסק עדכן את פרטי התור שלך',
                url: '/biz/' + business.slug,
              },
            });
          }
        }
        return { appointment: updated.rows[0], push_event_id: pushEventId };
      });
      void processGoogleCalendarJobs(req.tenantId, 5).catch((error) => req.log.warn({ err: error }, 'Google Calendar sync after appointment update failed'));
      const response = updateResult as { appointment: Record<string, unknown>; push_event_id: string | null };
      if (response.push_event_id) await dispatchPushEventAfterCommit(req.tenantId, response.push_event_id, req.log);
      return response.appointment;
    } catch (error) { slotConflict(error); throw error; }
  });

  app.delete('/appointments/:id', async (req, reply) => {
    const id = idFrom(req);
    const result = await withTenant(req.tenantId, async (db) => {
      const current = (await db.query('SELECT id, source FROM appointments WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!current) throw new HttpError(404, 'not_found');
      const waitlist = await db.query('SELECT id FROM waitlist_entries WHERE appointment_id = $1 LIMIT 1', [id]);
      const eligible = current.source === 'website' || Boolean(waitlist.rows[0]);
      let pushEventId: string | null = null;
      if (eligible) {
        const business = (await db.query('SELECT slug FROM businesses WHERE id = app.current_tenant_id()')).rows[0];
        pushEventId = await enqueuePushEvent(db, req.tenantId, {
          audience: 'customer', eventType: 'customer.appointment_cancelled',
          targetType: 'appointment', targetId: id,
          payload: { title: 'עדכון לגבי התור', body: 'העסק עדכן את מצב התור שלך', url: '/biz/' + business.slug },
        });
      }
      await db.query(
        "UPDATE waitlist_entries SET status = 'rejected', appointment_id = NULL, updated_at = now() WHERE appointment_id = $1",
        [id],
      );
      const deleted = await db.query('DELETE FROM appointments WHERE id = $1 RETURNING id', [id]);
      if (!deleted.rowCount) throw new HttpError(404, 'not_found');
      return { ...deleted.rows[0], push_event_id: pushEventId };
    });
    void processGoogleCalendarJobs(req.tenantId, 5).catch((error) => req.log.warn({ err: error }, 'Google Calendar sync after appointment delete failed'));
    if (result.push_event_id) await dispatchPushEventAfterCommit(req.tenantId, result.push_event_id, req.log);
    return reply.code(204).send();
  });

  app.post('/appointment-blocks', async (req, reply) => {
    const input = BlockInput.parse(req.body);
    if (input.end_at <= input.start_at) throw new HttpError(400, 'invalid_block_range');
    const block = await withTenant(req.tenantId, async (db) => {
      const biz = (await db.query('SELECT timezone FROM businesses WHERE id = app.current_tenant_id()')).rows[0];
      if (!biz) throw new HttpError(404, 'not_found');
      const created = (await db.query(
        `INSERT INTO appointment_blocks (tenant_id, start_at, end_at, reason)
         VALUES (app.current_tenant_id(), ($1::timestamp AT TIME ZONE $3), ($2::timestamp AT TIME ZONE $3), $4)
         RETURNING id, start_at, end_at, reason`,
        [input.start_at, input.end_at, biz.timezone, input.reason],
      )).rows[0];
      const conflicts = Number((await db.query(
        `SELECT count(*)::int AS n FROM appointments
          WHERE status = 'reserved'
            AND tstzrange(start_at, end_at, '[)') &&
                tstzrange(($1::timestamp AT TIME ZONE $3), ($2::timestamp AT TIME ZONE $3), '[)')`,
        [input.start_at, input.end_at, biz.timezone],
      )).rows[0].n);
      return { ...created, conflicting_appointments: conflicts };
    });
    return reply.code(201).send(block);
  });

  app.delete('/appointment-blocks/:id', async (req, reply) => {
    const id = idFrom(req);
    return withTenant(req.tenantId, async (db) => {
      const result = await db.query('DELETE FROM appointment_blocks WHERE id = $1 RETURNING id', [id]);
      if (!result.rowCount) throw new HttpError(404, 'not_found');
      return reply.code(204).send();
    });
  });
};
