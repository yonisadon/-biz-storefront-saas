import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { env } from '../config';
import { pool, withTenant } from '../db';
import { HttpError } from '../errors';
import { validateConfig } from '../configValidator';
import { BusinessPatch, LeadListQuery, LeadNoteInput, LeadStatusPatch } from '../schemas';
import { resolveByToken } from '../tenant';
import { catalogRoutes } from './catalog';
import { appointmentRoutes } from './appointments';
import { manageWaitlistRoutes } from './waitlist';
import { googleCalendarManageRoutes } from './googleCalendar';
import { processGoogleCalendarJobs } from '../googleCalendarService';
import { hashPushCapability, isSupportedPushEndpoint, type BrowserPushSubscription } from '../pushCrypto';
import { savePushSubscription } from '../pushService';

export const manageRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', resolveByToken);
  // The token lives in the URL: never cache, never leak via Referer
  app.addHook('onSend', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('Referrer-Policy', 'no-referrer');
  });

  await app.register(catalogRoutes);
  await app.register(appointmentRoutes);
  await app.register(manageWaitlistRoutes);
  await app.register(googleCalendarManageRoutes);

  app.get('/push/settings', async (req) => {
    const entitlement = await pool.query(
      "SELECT enabled FROM public.platform_channel_entitlements WHERE tenant_id = $1 AND channel = 'push'",
      [req.tenantId],
    );
    const tenantState = await withTenant(req.tenantId, async (db) => {
      await db.query(
        "INSERT INTO public.push_settings (tenant_id) VALUES (app.current_tenant_id()) ON CONFLICT (tenant_id) DO NOTHING",
      );
      const settings = (await db.query(
        "SELECT seller_enabled, customer_enabled FROM public.push_settings WHERE tenant_id = app.current_tenant_id()",
      )).rows[0];
      const devices = Number((await db.query(
        "SELECT count(*)::int AS count FROM public.push_subscriptions WHERE tenant_id = app.current_tenant_id() AND audience = 'seller' AND disabled_at IS NULL",
      )).rows[0].count);
      return { settings, devices };
    });
    const settings = tenantState.settings;
    const entitled = entitlement.rows[0]?.enabled === true;
    const configured = Boolean(env.WEB_PUSH_VAPID_PUBLIC_KEY && env.WEB_PUSH_VAPID_PRIVATE_KEY &&
      env.WEB_PUSH_VAPID_SUBJECT && env.PUSH_SUBSCRIPTION_ENCRYPTION_KEY && env.PUSH_CAPABILITY_HMAC_KEY);
    const devices = tenantState.devices;
    return {
      entitled, configured, public_key: entitled && configured ? env.WEB_PUSH_VAPID_PUBLIC_KEY : null,
      seller_enabled: settings?.seller_enabled === true,
      customer_enabled: settings?.customer_enabled === true,
      seller_effective: entitled && configured && settings?.seller_enabled === true,
      customer_effective: entitled && configured && settings?.customer_enabled === true,
      seller_devices: devices,
    };
  });

  app.patch('/push/settings', async (req) => {
    const input = z.object({
      seller_enabled: z.boolean().optional(),
      customer_enabled: z.boolean().optional(),
    }).strict().refine((value) => value.seller_enabled !== undefined || value.customer_enabled !== undefined).parse(req.body);
    const entitlement = await pool.query(
      "SELECT enabled FROM public.platform_channel_entitlements WHERE tenant_id = $1 AND channel = 'push'",
      [req.tenantId],
    );
    if (entitlement.rows[0]?.enabled !== true && (input.seller_enabled === true || input.customer_enabled === true)) {
      throw new HttpError(403, 'push_not_available');
    }
    return withTenant(req.tenantId, async (db) => {
      const current = (await db.query(
        "SELECT seller_enabled, customer_enabled FROM public.push_settings WHERE tenant_id = app.current_tenant_id() FOR UPDATE",
      )).rows[0] ?? { seller_enabled: true, customer_enabled: true };
      const sellerEnabled = input.seller_enabled ?? current.seller_enabled;
      const customerEnabled = input.customer_enabled ?? current.customer_enabled;
      const updated = await db.query(
        "INSERT INTO public.push_settings (tenant_id, seller_enabled, customer_enabled) " +
        "VALUES (app.current_tenant_id(), $1, $2) ON CONFLICT (tenant_id) DO UPDATE SET " +
        "seller_enabled = EXCLUDED.seller_enabled, customer_enabled = EXCLUDED.customer_enabled, updated_at = now() " +
        "RETURNING seller_enabled, customer_enabled",
        [sellerEnabled, customerEnabled],
      );
      return updated.rows[0];
    });
  });

  app.post('/push/subscriptions', async (req) => {
    const input = z.object({
      subscription: z.object({
        endpoint: z.string().url().max(2048),
        keys: z.object({ p256dh: z.string().min(80).max(120), auth: z.string().min(20).max(40) }).strict(),
      }).strict(),
    }).strict().parse(req.body);
    if (!isSupportedPushEndpoint(input.subscription.endpoint)) throw new HttpError(400, 'invalid_push_subscription');
    const entitlement = await pool.query(
      "SELECT enabled FROM public.platform_channel_entitlements WHERE tenant_id = $1 AND channel = 'push'",
      [req.tenantId],
    );
    if (entitlement.rows[0]?.enabled !== true) throw new HttpError(403, 'push_not_available');
    if (!env.WEB_PUSH_VAPID_PUBLIC_KEY || !env.WEB_PUSH_VAPID_PRIVATE_KEY ||
        !env.WEB_PUSH_VAPID_SUBJECT || !env.PUSH_SUBSCRIPTION_ENCRYPTION_KEY || !env.PUSH_CAPABILITY_HMAC_KEY) {
      throw new HttpError(503, 'push_not_configured');
    }
    return withTenant(req.tenantId, async (db) => {
      const settings = (await db.query(
        "SELECT seller_enabled FROM public.push_settings WHERE tenant_id = app.current_tenant_id()",
      )).rows[0];
      if (settings?.seller_enabled !== true) throw new HttpError(403, 'seller_push_disabled');
      const id = await savePushSubscription(db, req.tenantId, 'seller', input.subscription as BrowserPushSubscription);
      return { ok: true, subscription_id: id };
    });
  });

  app.delete('/push/subscriptions', async (req) => {
    const input = z.object({ endpoint: z.string().url().max(2048) }).strict().parse(req.body);
    if (!isSupportedPushEndpoint(input.endpoint)) throw new HttpError(400, 'invalid_push_subscription');
    return withTenant(req.tenantId, async (db) => {
      await db.query(
        "UPDATE public.push_subscriptions SET disabled_at = now(), updated_at = now() " +
        "WHERE tenant_id = app.current_tenant_id() AND audience = 'seller' AND endpoint_hash = $1 AND disabled_at IS NULL",
        [hashPushCapability(input.endpoint)],
      );
      return { ok: true };
    });
  });

  // ---- Business profile ----
  app.get('/business', async (req) => {
    const biz = await withTenant(req.tenantId, async (db) => {
      const result = await db.query(
        `SELECT name, slug, status, phone, whatsapp_number, email, about_text,
                locale, timezone, config
           FROM businesses WHERE id = app.current_tenant_id()`,
      );
      return result.rows[0];
    });
    if (!biz) throw new HttpError(404, 'not_found');
    const onboarding = await pool.query(
      'SELECT app.get_tenant_onboarding_completed_at($1) AS completed_at',
      [req.tenantId],
    );
    return { ...biz, onboarding_completed_at: onboarding.rows[0]?.completed_at ?? null };
  });

  app.post('/onboarding/complete', async (req) => {
    const result = await pool.query(
      'SELECT app.complete_tenant_onboarding($1) AS completed_at',
      [req.tenantId],
    );
    if (!result.rows[0]?.completed_at) throw new HttpError(404, 'not_found');
    return { completed_at: result.rows[0].completed_at };
  });

  app.patch('/business', async (req) => {
    const patch = BusinessPatch.parse(req.body);

    return withTenant(req.tenantId, async (db) => {
      const cur = (await db.query(
        'SELECT config FROM businesses WHERE id = app.current_tenant_id() FOR UPDATE',
      )).rows[0];
      if (!cur) throw new HttpError(404, 'not_found');

      const sets: string[] = [];
      const vals: unknown[] = [];
      let futureReservedAppointments = 0;
      let openingHoursChanged = false;
      // column names below are hard-coded, never user input
      const set = (col: string, v: unknown, cast = '') => {
        vals.push(v);
        sets.push(`${col} = $${vals.length}${cast}`);
      };

      if (patch.name !== undefined) set('name', patch.name);
      if (patch.phone !== undefined) set('phone', patch.phone);
      if (patch.whatsapp_number !== undefined) set('whatsapp_number', patch.whatsapp_number);
      if (patch.email !== undefined) set('email', patch.email);
      if (patch.about_text !== undefined) set('about_text', patch.about_text || null);

      if (patch.config) {
        // Sections you send replace the whole section; others are kept. version is fixed.
        openingHoursChanged = Object.prototype.hasOwnProperty.call(patch.config, 'opening_hours');
        if (openingHoursChanged) {
          futureReservedAppointments = Number((await db.query(
            "SELECT count(*)::int AS n FROM appointments WHERE status = 'reserved' AND end_at > now()",
          )).rows[0].n);
        }
        const merged = { ...cur.config, ...patch.config, version: 1 };
        const errors = validateConfig(merged);
        if (errors) throw new HttpError(422, 'invalid_config', 'Config failed validation', errors);
        set('config', JSON.stringify(merged), '::jsonb');
      }

      if (!sets.length) throw new HttpError(400, 'empty_patch');

      // DB CHECKs (route needs number, at least one route) are the final guard
      const r = await db.query(
        `UPDATE businesses SET ${sets.join(', ')}
          WHERE id = app.current_tenant_id()
          RETURNING name, phone, whatsapp_number, email, about_text, config`,
        vals,
      );
      return {
        ...r.rows[0],
        ...(openingHoursChanged && futureReservedAppointments > 0
          ? { warnings: { future_reserved_appointments: futureReservedAppointments } }
          : {}),
      };
    });
  });

  app.get('/crm-retention', async (req) => {
    const planResult = await pool.query(
      'SELECT app.get_tenant_plan_code($1) AS plan_code',
      [req.tenantId],
    );
    const planCode = planResult.rows[0]?.plan_code as string | undefined;
    if (!planCode) throw new HttpError(503, 'retention_policy_unavailable');
    const policies = await pool.query(
      'SELECT record_status, delete_enabled, retention_days FROM public.platform_retention_policies WHERE plan_code = $1 AND record_type = $2',
      [planCode, 'lead'],
    );
    const byStatus = new Map(policies.rows.map((row) => [row.record_status, row]));
    const open = byStatus.get('open');
    const closed = byStatus.get('closed');
    if (!open || !closed) throw new HttpError(503, 'retention_policy_unavailable');
    const openDays = open.delete_enabled ? Number(open.retention_days) : null;
    const closedDays = closed.delete_enabled ? Number(closed.retention_days) : null;

    return withTenant(req.tenantId, async (db) => {
      const result = await db.query(
        `SELECT
           count(*) FILTER (WHERE expires_at <= now())::int AS overdue,
           count(*) FILTER (WHERE expires_at > now() AND expires_at <= now() + interval '24 hours')::int AS due_within_24_hours,
           count(*) FILTER (WHERE expires_at > now() AND expires_at <= now() + interval '7 days')::int AS due_within_7_days,
           min(expires_at) AS next_expiry_at
         FROM (
           SELECT CASE
             WHEN status IN ('rejected', 'cancelled', 'completed')
               THEN CASE WHEN $1::int IS NULL OR retention_closed_at IS NULL THEN NULL
                         ELSE retention_closed_at + ($1::int * interval '1 day') END
             ELSE CASE WHEN $2::int IS NULL OR retention_opened_at IS NULL THEN NULL
                       ELSE retention_opened_at + ($2::int * interval '1 day') END
           END AS expires_at
           FROM leads
         ) deadlines`,
        [closedDays, openDays],
      );
      return {
        policy: 'platform-retention-v1',
        plan_code: planCode,
        automatic_deletion_enabled: openDays !== null || closedDays !== null,
        ...result.rows[0],
      };
    });
  });

  // ---- Leads ----
  app.get('/leads', async (req) => {
    const q = LeadListQuery.parse(req.query);
    return withTenant(req.tenantId, async (db) => {
      const { rows } = await db.query(
        `SELECT l.id, l.customer_name, l.customer_phone, l.customer_email, l.message,
                l.submission_channel, l.status, l.estimated_total_agorot, l.metadata, l.created_at,
                COALESCE((
                  SELECT json_agg(json_build_object(
                           'name', i.item_name,
                           'unit_price_agorot', i.unit_price_agorot,
                           'quantity', i.quantity) ORDER BY i.created_at)
                    FROM lead_items i WHERE i.lead_id = l.id
                ), '[]'::json) AS items,
                COALESCE((
                  SELECT json_agg(json_build_object('body', n.body, 'created_at', n.created_at) ORDER BY n.created_at)
                    FROM lead_notes n WHERE n.lead_id = l.id
                ), '[]'::json) AS notes,
                count(*) OVER() AS total
           FROM leads l
          WHERE ($1::text IS NULL OR l.status = $1)
            AND ($2::text IS NULL OR position(lower($2) in lower(coalesce(l.customer_name, '') || ' ' || coalesce(l.customer_phone, ''))) > 0)
          ORDER BY l.created_at DESC, l.id DESC
          LIMIT $3 OFFSET $4`,
        [q.status ?? null, q.search || null, q.limit, q.offset],
      );
      const total = rows[0] ? Number(rows[0].total) : 0;
      return {
        total, limit: q.limit, offset: q.offset,
        leads: rows.map(({ total: _t, ...lead }) => lead),
      };
    });
  });

  app.get('/leads/:id/notes', async (req) => {
    const id = (req.params as { id: string }).id;
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, 'not_found');
    return withTenant(req.tenantId, async (db) => {
      const exists = await db.query('SELECT 1 FROM leads WHERE id = $1', [id]);
      if (!exists.rowCount) throw new HttpError(404, 'not_found');
      return (await db.query(
        'SELECT id, body, created_at, updated_at FROM lead_notes WHERE lead_id = $1 ORDER BY created_at DESC, id DESC',
        [id],
      )).rows;
    });
  });

  app.post('/leads/:id/notes', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, 'not_found');
    const { body } = LeadNoteInput.parse(req.body);
    const note = await withTenant(req.tenantId, async (db) => {
      const exists = await db.query('SELECT 1 FROM leads WHERE id = $1', [id]);
      if (!exists.rowCount) throw new HttpError(404, 'not_found');
      const result = await db.query(
        'INSERT INTO lead_notes (tenant_id, lead_id, body) VALUES (app.current_tenant_id(), $1, $2) RETURNING id, body, created_at, updated_at',
        [id, body],
      );
      return result.rows[0];
    });
    return reply.code(201).send(note);
  });

  // Permanently delete one lead and its related items/notes (FKs cascade).
  // The tenant-specific DB and RLS context ensure a seller cannot delete another tenant's lead.
  app.delete('/leads/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, 'not_found');
    return withTenant(req.tenantId, async (db) => {
      const result = await db.query(
        'DELETE FROM leads WHERE id = $1 RETURNING id',
        [id],
      );
      if (!result.rowCount) throw new HttpError(404, 'not_found');
      return reply.code(204).send();
    });
  });

  app.patch('/leads/:id', async (req) => {
    const id = (req.params as { id: string }).id;
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, 'not_found');
    const { status } = LeadStatusPatch.parse(req.body);
    const updatedLead = await withTenant(req.tenantId, async (db) => {
      const r = await db.query(
        'UPDATE leads SET status = $1 WHERE id = $2 RETURNING id, status, updated_at',
        [status, id],
      );
      if (!r.rows[0]) throw new HttpError(404, 'not_found'); // also hit for other tenants' ids
      if (status === 'rejected' || status === 'cancelled') {
        await db.query(
          "UPDATE appointments SET status = 'cancelled', status_changed_at = now() WHERE lead_id = $1 AND status = 'reserved'",
          [id],
        );
      }
      return r.rows[0];
    });
    void processGoogleCalendarJobs(req.tenantId, 5).catch((error) => req.log.warn({ err: error }, 'Google Calendar sync after lead status change failed'));
    return updatedLead;
  });
};