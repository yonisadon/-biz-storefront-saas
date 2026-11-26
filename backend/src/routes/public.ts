import type { FastifyPluginAsync, preHandlerAsyncHookHandler } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { env } from '../config';
import { pool, withTenant } from '../db';
import { HttpError } from '../errors';
import { LeadInput, LegalDoc } from '../schemas';
import { resolveContactOptions, resolveLeadRoute } from '../crmRouting';
import { quarterHourStartMinutes, validateAppointmentSelection } from '../appointmentRules';
import { PublicCatalogQuery } from '../catalogSchemas';
import { ils, isOpenNow, mediaUrl, toLocalPhone } from '../util';
import { ogKey as ogVariant } from '../storage'; // <-- 1. הוספת אימפורט זה
import { processGoogleCalendarJobs } from '../googleCalendarService';
import { hashPushCapability, isSupportedPushEndpoint, type BrowserPushSubscription } from '../pushCrypto';
import { dispatchPushEventAfterCommit, enqueuePushEvent, issuePushCapability, savePushSubscription } from '../pushService';
import { publicWaitlistRoutes } from './waitlist';

const DEFAULT_WA_INTRO = 'שלום, אשמח לקבל פרטים נוספים לגבי המוצרים או השירותים הבאים:';
const DEFAULT_QUOTE_LABEL = 'להצעת מחיר';

const PUBLIC_CATALOG_PAGE_SIZE = 12;
async function loadPublicCatalog(db: pg.PoolClient, kind: 'product' | 'service' | null, limit: number | null, offset = 0, search = '') {
  const term = search.trim();
  const where = `WHERE p.is_active AND ($1::text IS NULL OR p.kind = $1) AND ($2::text = '' OR p.name ILIKE '%' || $2 || '%' OR COALESCE(p.description, '') ILIKE '%' || $2 || '%')`;
  const columns = `p.id, p.kind, p.name, p.description, p.details, p.price_agorot, p.appointment_duration_minutes, m.storage_key, m.width, m.height,
         COALESCE((
           SELECT json_agg(json_build_object('id', pi.id, 'storage_key', pm.storage_key, 'width', pm.width, 'height', pm.height, 'position', pi.position) ORDER BY pi.position)
             FROM product_images pi
             JOIN media_assets pm ON pm.tenant_id = pi.tenant_id AND pm.id = pi.asset_id
            WHERE pi.tenant_id = p.tenant_id AND pi.product_id = p.id
         ), '[]'::json) AS extra_images`;
  const select = limit === null
    ? `SELECT ${columns} FROM products p LEFT JOIN media_assets m ON m.tenant_id = p.tenant_id AND m.id = p.image_asset_id ${where} ORDER BY p.sort_order, p.created_at`
    : `SELECT ${columns}, count(*) OVER()::int AS total FROM products p LEFT JOIN media_assets m ON m.tenant_id = p.tenant_id AND m.id = p.image_asset_id ${where} ORDER BY p.sort_order, p.created_at LIMIT $3 OFFSET $4`;
  const result = await db.query(select, limit === null ? [kind, term] : [kind, term, limit, offset]);
  const items = result.rows.map((r) => ({
    id: r.id, kind: r.kind, name: r.name, description: r.description, details: r.details ?? [], price_agorot: r.price_agorot,
    appointment_duration_minutes: r.appointment_duration_minutes ?? 30,
    image: r.storage_key ? { url: mediaUrl(env.MEDIA_BASE_URL, r.storage_key), width: r.width, height: r.height } : null,
    additional_images: (r.extra_images ?? []).map((image: any) => ({ id: image.id, url: mediaUrl(env.MEDIA_BASE_URL, image.storage_key), width: image.width, height: image.height, position: image.position })),
  }));
  let total = limit === null ? items.length : (result.rows[0] ? Number(result.rows[0].total) : 0);
  if (limit !== null && items.length === 0 && offset > 0) {
    const count = await db.query(`SELECT count(*)::int AS total FROM products p ${where}`, [kind, term]);
    total = Number(count.rows[0].total);
  }
  return { items, total, limit, offset, has_more: limit !== null && offset + items.length < total };
}

async function loadBusiness(db: pg.PoolClient) {
  const { rows } = await db.query(
    `SELECT name, slug, phone, whatsapp_number, email, about_text, locale, timezone, config
       FROM businesses WHERE id = app.current_tenant_id()`,
  );
  if (!rows[0]) throw new HttpError(404, 'not_found');
  return rows[0];
}

async function buildPublicPayload(db: pg.PoolClient) {
  const biz = await loadBusiness(db);
  const cfg = biz.config ?? {};
  const flow = cfg.order_flow ?? {};
  // Missing flags preserve legacy behavior for existing businesses.
  const hours = cfg.opening_hours ?? {};

  const legacyCalendarServices = !cfg.contact_options && Boolean((await db.query(
    "SELECT EXISTS (SELECT 1 FROM products WHERE kind = 'service' AND is_active AND COALESCE(booking_mode, CASE WHEN requires_appointment THEN 'free_datetime' ELSE 'none' END) <> 'none') AS enabled",
  )).rows[0]?.enabled);
  const contactOptions = resolveContactOptions(cfg, legacyCalendarServices);
  const products = await loadPublicCatalog(db, 'product', PUBLIC_CATALOG_PAGE_SIZE);
  const services = await loadPublicCatalog(db, 'service', PUBLIC_CATALOG_PAGE_SIZE);

  const galleryRows = (await db.query(
    `SELECT pi.id, pi.position, pi.alt_text, pi.caption, m.storage_key, m.width, m.height
       FROM portfolio_images pi
       JOIN media_assets m ON m.tenant_id = pi.tenant_id AND m.id = pi.asset_id
      ORDER BY pi.position`,
  )).rows;
  const gallery = galleryRows.map((r) => ({
    id: r.id,
    url: mediaUrl(env.MEDIA_BASE_URL, r.storage_key),
    alt: r.alt_text, caption: r.caption, width: r.width, height: r.height,
  }));

  // Open Graph data (the frontend/SSR layer renders the <meta> tags from this)
  let ogKey: string | null = null;
  if (cfg.seo?.og_image_asset_id) {
    const r = await db.query('SELECT storage_key FROM media_assets WHERE id = $1', [cfg.seo.og_image_asset_id]);
    ogKey = r.rows[0]?.storage_key ?? null;
  }
  const selectedHeroId = cfg.branding?.hero_gallery_image_id;
  const selectedHero = selectedHeroId ? galleryRows.find((r) => r.id === selectedHeroId) : null;
  ogKey = selectedHero?.storage_key ?? ogKey ?? galleryRows[0]?.storage_key ?? null;

  const openNow = isOpenNow(hours, biz.timezone);
  return {
    business: {
      name: biz.name, slug: biz.slug, phone: biz.phone,
      whatsapp_number: biz.whatsapp_number, email: biz.email,
      locale: biz.locale, timezone: biz.timezone,
    },
    about: biz.about_text,                       // null => component hidden
    branding: cfg.branding ?? {},
    social_links: cfg.social_links ?? {},
    business_profile: cfg.business_profile ?? {},
    business_announcement: {
      enabled: cfg.business_announcement?.enabled === true,
      message: typeof cfg.business_announcement?.message === 'string' ? cfg.business_announcement.message : '',
    },
    contact_options: contactOptions,
    order_flow: {
      whatsapp_enabled: contactOptions.products.whatsapp_enabled || contactOptions.services.whatsapp_enabled,
      site_inquiry_enabled: contactOptions.products.crm_enabled,
      // The same seller-defined opening is used for general contact and order messages.
      whatsapp_intro: String(flow.whatsapp_intro ?? '').trim() || DEFAULT_WA_INTRO,
    },
    opening_hours: {
      days: hours.days ?? null,
      open_now: openNow,
      show_out_of_hours_banner: hours.out_of_hours_banner?.enabled !== false && openNow === false,
      banner_message: hours.out_of_hours_banner?.message ?? null,
    },
    catalog: { quote_label: cfg.catalog?.quote_label ?? DEFAULT_QUOTE_LABEL, products, services },
    gallery,                                      // [] => component hidden
    sections: { about: !!biz.about_text, gallery: gallery.length > 0 },
    og: {
      title: cfg.seo?.title ?? biz.name,
      description: cfg.seo?.description ?? (biz.about_text ? String(biz.about_text).slice(0, 160) : null),
      // <-- 2. עדכון השורה הזו להשתמש ב-ogVariant:
      image_url: ogKey ? mediaUrl(env.MEDIA_BASE_URL, ogVariant(ogKey)) : null,
    },
  };
}

export const publicRoutes = (resolver: preHandlerAsyncHookHandler): FastifyPluginAsync =>
  async (app) => {
    app.addHook('preHandler', resolver);
    await app.register(publicWaitlistRoutes);

    app.get('/push/config', async (req) => {
      const entitlement = await pool.query(
        "SELECT enabled FROM public.platform_channel_entitlements WHERE tenant_id = $1 AND channel = 'push'",
        [req.tenantId],
      );
      const settings = await withTenant(req.tenantId, async (db) => (await db.query(
        "SELECT customer_enabled FROM public.push_settings WHERE tenant_id = app.current_tenant_id()",
      )).rows[0]);
      const configured = Boolean(env.WEB_PUSH_VAPID_PUBLIC_KEY && env.WEB_PUSH_VAPID_PRIVATE_KEY &&
        env.WEB_PUSH_VAPID_SUBJECT && env.PUSH_SUBSCRIPTION_ENCRYPTION_KEY && env.PUSH_CAPABILITY_HMAC_KEY);
      const enabled = entitlement.rows[0]?.enabled === true && settings?.customer_enabled === true && configured;
      return { enabled, public_key: enabled ? env.WEB_PUSH_VAPID_PUBLIC_KEY : null };
    });

    app.post('/push/subscriptions/customer/status', async (req) => {
      const input = z.object({ endpoint: z.string().url().max(2048) }).strict().parse(req.body);
      if (!isSupportedPushEndpoint(input.endpoint)) throw new HttpError(400, 'invalid_push_subscription');
      return withTenant(req.tenantId, async (db) => {
        const result = await db.query(
          "SELECT s.id FROM public.push_subscriptions s " +
          "JOIN public.push_device_consents c ON c.tenant_id = s.tenant_id AND c.subscription_id = s.id " +
          "WHERE s.tenant_id = app.current_tenant_id() AND s.audience = 'customer' " +
          "AND s.endpoint_hash = $1 AND s.disabled_at IS NULL AND c.revoked_at IS NULL",
          [hashPushCapability(input.endpoint)],
        );
        return { active: result.rows.length > 0 };
      });
    });

    app.post('/push/consent', async (req) => {
      const input = z.object({
        token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
        explicit_consent: z.boolean().default(false),
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

      const consentResult = await withTenant(req.tenantId, async (db) => {
        const customerSettings = (await db.query(
          "SELECT customer_enabled FROM public.push_settings WHERE tenant_id = app.current_tenant_id()",
        )).rows[0];
        if (customerSettings?.customer_enabled !== true) throw new HttpError(403, 'customer_push_disabled');
        const capability = (await db.query(
          "SELECT id, target_type, target_id, linked_at, subscription_id FROM public.push_target_link_capabilities " +
          "WHERE tenant_id = app.current_tenant_id() AND token_hash = $1 AND expires_at > now() AND revoked_at IS NULL FOR UPDATE",
          [hashPushCapability(input.token)],
        )).rows[0];
        if (!capability) throw new HttpError(404, 'push_consent_expired');

        const subscriptionId = await savePushSubscription(
          db, req.tenantId, 'customer', input.subscription as BrowserPushSubscription,
        );
        const deviceConsent = (await db.query(
          "SELECT id, revoked_at FROM public.push_device_consents " +
          "WHERE tenant_id = app.current_tenant_id() AND subscription_id = $1 FOR UPDATE",
          [subscriptionId],
        )).rows[0];
        const hasActiveConsent = Boolean(deviceConsent && !deviceConsent.revoked_at);
        if (!hasActiveConsent && !input.explicit_consent) {
          throw new HttpError(403, 'push_device_consent_required');
        }
        if (deviceConsent) {
          if (deviceConsent.revoked_at && input.explicit_consent) {
            await db.query(
              "UPDATE public.push_device_consents SET consented_at = now(), revoked_at = NULL, updated_at = now() WHERE id = $1",
              [deviceConsent.id],
            );
          }
        } else {
          await db.query(
            "INSERT INTO public.push_device_consents (tenant_id, subscription_id, purpose) " +
            "VALUES (app.current_tenant_id(), $1, 'operational')",
            [subscriptionId],
          );
        }

        if (capability.linked_at && capability.subscription_id !== subscriptionId) {
          throw new HttpError(409, 'push_target_already_linked');
        }
        await db.query(
          "INSERT INTO public.push_subscription_targets (tenant_id, target_type, target_id, subscription_id, revoked_at) " +
          "VALUES (app.current_tenant_id(), $1, $2, $3, NULL) " +
          "ON CONFLICT (tenant_id, target_type, target_id, subscription_id) " +
          "DO UPDATE SET revoked_at = NULL, consented_at = now()",
          [capability.target_type, capability.target_id, subscriptionId],
        );
        await db.query(
          "UPDATE public.push_target_link_capabilities SET linked_at = COALESCE(linked_at, now()), subscription_id = $1 WHERE id = $2",
          [subscriptionId, capability.id],
        );
        return {
          target_type: capability.target_type as 'appointment' | 'waitlist',
          target_id: capability.target_id as string,
          already_enabled: hasActiveConsent,
        };
      });

      if (consentResult.target_type === 'appointment') {
        const pendingEvents = await withTenant(req.tenantId, async (db) => (await db.query(
          "SELECT id FROM public.push_outbox WHERE tenant_id = app.current_tenant_id() " +
          "AND audience = 'customer' AND event_type = 'customer.waitlist_scheduled' " +
          "AND target_type = 'appointment' AND target_id = $1 AND status = 'pending' ORDER BY created_at",
          [consentResult.target_id],
        )).rows.map((row) => row.id as string));
        for (const eventId of pendingEvents) {
          await dispatchPushEventAfterCommit(req.tenantId, eventId, req.log);
        }
      }
      return { ok: true, already_enabled: consentResult.already_enabled };
    });

    app.delete('/push/subscriptions/customer', async (req) => {
      const input = z.object({ endpoint: z.string().url().max(2048) }).strict().parse(req.body);
      if (!isSupportedPushEndpoint(input.endpoint)) throw new HttpError(400, 'invalid_push_subscription');
      return withTenant(req.tenantId, async (db) => {
        const subscription = (await db.query(
          "SELECT id FROM public.push_subscriptions WHERE tenant_id = app.current_tenant_id() " +
          "AND audience = 'customer' AND endpoint_hash = $1 FOR UPDATE",
          [hashPushCapability(input.endpoint)],
        )).rows[0];
        if (!subscription) return { ok: true };
        await db.query(
          "UPDATE public.push_subscriptions SET disabled_at = COALESCE(disabled_at, now()), updated_at = now() WHERE id = $1",
          [subscription.id],
        );
        await db.query(
          "UPDATE public.push_device_consents SET revoked_at = COALESCE(revoked_at, now()), updated_at = now() " +
          "WHERE tenant_id = app.current_tenant_id() AND subscription_id = $1",
          [subscription.id],
        );
        await db.query(
          "UPDATE public.push_subscription_targets SET revoked_at = COALESCE(revoked_at, now()) " +
          "WHERE tenant_id = app.current_tenant_id() AND subscription_id = $1 AND revoked_at IS NULL",
          [subscription.id],
        );
        return { ok: true };
      });
    });

    // Business config + first catalog page + gallery in one round trip.
    app.get('/', async (req) => withTenant(req.tenantId, buildPublicPayload));
    app.get('/catalog', async (req) => {
      const q = PublicCatalogQuery.parse(req.query);
      return withTenant(req.tenantId, async (db) => loadPublicCatalog(db, q.kind ?? null, q.limit, q.offset, q.search));
    });

    // Legal texts are fetched separately (can be large). null => use platform default.
    app.get('/legal/:doc', async (req) => {
      const doc = LegalDoc.parse((req.params as { doc: string }).doc);
      return withTenant(req.tenantId, async (db) => {
        const biz = await loadBusiness(db);
        return { doc, custom_text: biz.config?.legal?.[doc]?.custom_text ?? null };
      });
    });

    // Minimal month summary for the customer calendar. It returns dates only (never
    // appointment/customer data); exact times are still loaded by /availability.
    app.get('/availability/month', async (req) => {
      const query = z.object({
        month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
        items: z.string().min(1).max(3000),
      }).parse(req.query);
      const selected = query.items.split(',').map((entry) => {
        const match = /^([0-9a-f-]{36}):(\d{1,4})$/i.exec(entry);
        if (!match) throw new HttpError(400, 'invalid_items');
        const quantity = Number(match[2]);
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 9999) throw new HttpError(400, 'invalid_items');
        return { id: match[1], quantity };
      });
      if (!selected.length || selected.length > 50 || new Set(selected.map((item) => item.id)).size !== selected.length) {
        throw new HttpError(400, 'invalid_items');
      }

      return withTenant(req.tenantId, async (db) => {
        const biz = await loadBusiness(db);
        const ids = selected.map((item) => item.id);
        const rows = (await db.query(
          'SELECT id, kind, appointment_duration_minutes FROM products WHERE is_active AND id = ANY($1::uuid[])',
          [ids],
        )).rows;
        if (rows.length !== ids.length) throw new HttpError(400, 'unknown_product');
        if (rows.some((item) => item.kind !== 'service')) throw new HttpError(400, 'mixed_catalog_types');
        const legacyCalendar = !biz.config?.contact_options && Boolean((await db.query(
          "SELECT EXISTS (SELECT 1 FROM products WHERE id = ANY($1::uuid[]) AND kind = 'service' AND is_active AND COALESCE(booking_mode, CASE WHEN requires_appointment THEN 'free_datetime' ELSE 'none' END) <> 'none') AS enabled",
          [ids],
        )).rows[0]?.enabled);
        if (!resolveContactOptions(biz.config, legacyCalendar).services.calendar_enabled) throw new HttpError(403, 'calendar_booking_disabled');
        const qty = new Map(selected.map((item) => [item.id, item.quantity]));
        const duration = rows.reduce((sum, item) => sum + (item.appointment_duration_minutes ?? 30) * (qty.get(item.id) ?? 1), 0);
        if (duration <= 0 || duration > 480) throw new HttpError(400, 'invalid_appointment_time');

        const days = biz.config?.opening_hours?.days;
        const [year, monthNumber] = query.month.split('-').map(Number);
        const monthStart = new Date(Date.UTC(year, monthNumber - 1, 1, 12));
        if (!Number.isFinite(monthStart.getTime()) || monthStart.toISOString().slice(0, 7) !== query.month) throw new HttpError(400, 'invalid_month');
        const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
        const candidates: { date: string; slot: string }[] = [];
        const toMinutes = (value: unknown) => {
          if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return Number.NaN;
          return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
        };
        for (let day = 1; day <= daysInMonth; day++) {
          const date = new Date(Date.UTC(year, monthNumber - 1, day, 12)).toISOString().slice(0, 10);
          const weekday = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date(`${date}T12:00:00Z`).getUTCDay()];
          const ranges = days && typeof days === 'object' ? days[weekday] : undefined;
          if (!Array.isArray(ranges)) continue;
          for (const range of ranges) {
            if (!range || typeof range !== 'object') continue;
            const open = toMinutes((range as { open?: unknown }).open);
            const close = toMinutes((range as { close?: unknown }).close);
            if (!Number.isFinite(open) || !Number.isFinite(close)) continue;
            for (const minute of quarterHourStartMinutes(open, close, duration)) {
              const slot = `${date}T${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
              if (!validateAppointmentSelection({ needsAppointment: true, appointmentAt: slot, durationMinutes: duration, openingHoursDays: days, timezone: biz.timezone })) {
                candidates.push({ date, slot: slot.slice(11) });
              }
            }
          }
        }
        if (!candidates.length) return { month: query.month, available_dates: [] };
        const candidateSlots = candidates.map((item) => `${item.date}T${item.slot}`);
        const available = await db.query(
          `SELECT candidate.slot
             FROM unnest($1::text[]) AS candidate(slot)
            WHERE NOT EXISTS (
              SELECT 1 FROM appointments a
               WHERE a.status = 'reserved'
                 AND tstzrange(a.start_at, a.end_at, '[)') &&
                     tstzrange((candidate.slot::timestamp AT TIME ZONE $2),
                       ((candidate.slot::timestamp AT TIME ZONE $2) + ($3::int * interval '1 minute')), '[)')
            ) AND NOT EXISTS (
              SELECT 1 FROM appointment_blocks b
               WHERE tstzrange(b.start_at, b.end_at, '[)') &&
                     tstzrange((candidate.slot::timestamp AT TIME ZONE $2),
                       ((candidate.slot::timestamp AT TIME ZONE $2) + ($3::int * interval '1 minute')), '[)')
            )`,
          [candidateSlots, biz.timezone, duration],
        );
        const availableDates = new Set<string>(available.rows.map((row: { slot: string }) => String(row.slot).slice(0, 10)));
        return { month: query.month, available_dates: [...availableDates] };
      });
    });

    // Return candidate times for the selected service cart, checking appointments and seller time blocks.
    app.get('/availability', async (req) => {
      const query = z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        items: z.string().min(1).max(3000),
      }).parse(req.query);
      const selected = query.items.split(',').map((entry) => {
        const match = /^([0-9a-f-]{36}):(\d{1,4})$/i.exec(entry);
        if (!match) throw new HttpError(400, 'invalid_items');
        const quantity = Number(match[2]);
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 9999) throw new HttpError(400, 'invalid_items');
        return { id: match[1], quantity };
      });
      if (selected.length > 50 || new Set(selected.map((item) => item.id)).size !== selected.length) {
        throw new HttpError(400, 'invalid_items');
      }

      return withTenant(req.tenantId, async (db) => {
        const biz = await loadBusiness(db);
        const ids = selected.map((item) => item.id);
        const rows = ids.length ? (await db.query(
          'SELECT id, kind, name, appointment_duration_minutes FROM products WHERE is_active AND id = ANY($1::uuid[])',
          [ids],
        )).rows : [];
        if (rows.length !== ids.length) throw new HttpError(400, 'unknown_product');
        if (rows.some((item) => item.kind !== 'service')) throw new HttpError(400, 'mixed_catalog_types');
        const legacyCalendar = !biz.config?.contact_options && Boolean((await db.query(
          "SELECT EXISTS (SELECT 1 FROM products WHERE id = ANY($1::uuid[]) AND kind = 'service' AND is_active AND COALESCE(booking_mode, CASE WHEN requires_appointment THEN 'free_datetime' ELSE 'none' END) <> 'none') AS enabled",
          [ids],
        )).rows[0]?.enabled);
        if (!resolveContactOptions(biz.config, legacyCalendar).services.calendar_enabled) throw new HttpError(403, 'calendar_booking_disabled');
        const qty = new Map(selected.map((item) => [item.id, item.quantity]));
        const duration = rows.reduce((sum, item) => sum + (item.appointment_duration_minutes ?? 30) * (qty.get(item.id) ?? 1), 0);
        if (duration <= 0 || duration > 480) throw new HttpError(400, 'invalid_appointment_time');

        const days = biz.config?.opening_hours?.days;
        const date = new Date(`${query.date}T12:00:00Z`);
        if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== query.date) {
          throw new HttpError(400, 'invalid_date');
        }
        const dayKey = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][date.getUTCDay()];
        const ranges = days && typeof days === 'object' ? days[dayKey] : undefined;
        if (!Array.isArray(ranges)) return { date: query.date, duration_minutes: duration, slots: [] };

        const toMinutes = (value: unknown) => {
          if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return Number.NaN;
          return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
        };
        const slots: string[] = [];
        for (const range of ranges) {
          if (!range || typeof range !== 'object') continue;
          const open = toMinutes((range as { open?: unknown }).open);
          const close = toMinutes((range as { close?: unknown }).close);
          if (!Number.isFinite(open) || !Number.isFinite(close)) continue;
          // Offer starts on the wall-clock quarter-hour grid, not every service duration.
          // Starting at 09:43 therefore rounds up to 09:45 rather than drifting by duration.
          for (const minute of quarterHourStartMinutes(open, close, duration)) {
            const slot = `${query.date}T${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
            if (validateAppointmentSelection({
              needsAppointment: true, appointmentAt: slot, durationMinutes: duration,
              openingHoursDays: days, timezone: biz.timezone,
            })) continue;
            {
              const availability = await db.query(
                `SELECT NOT EXISTS (
                   SELECT 1 FROM appointments a
                    WHERE a.status = 'reserved'
                      AND tstzrange(a.start_at, a.end_at, '[)') &&
                          tstzrange(($1::timestamp AT TIME ZONE $2),
                            (($1::timestamp AT TIME ZONE $2) + ($3::int * interval '1 minute')), '[)')
                 ) AND NOT EXISTS (
                   SELECT 1 FROM appointment_blocks b
                    WHERE tstzrange(b.start_at, b.end_at, '[)') &&
                          tstzrange(($1::timestamp AT TIME ZONE $2),
                            (($1::timestamp AT TIME ZONE $2) + ($3::int * interval '1 minute')), '[)')
                 ) AS available`,
                [slot, biz.timezone, duration],
              );
              if (availability.rows[0]?.available !== true) continue;
            }
            slots.push(slot.slice(11));
          }
        }
        return { date: query.date, duration_minutes: duration, slots };
      });
    });

    // Submit one product inquiry, service WhatsApp request, or service reservation.
    app.post(
      '/leads',
      { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
      async (req, reply) => {
        const body = LeadInput.parse(req.body);
        if (body.company_website) return reply.code(201).send({ ok: true });

        const result = await withTenant(req.tenantId, async (db) => {
          const biz = await loadBusiness(db);
          const flow = biz.config?.order_flow ?? {};
          const qty = new Map<string, number>();
          for (const item of body.items) {
            qty.set(item.product_id, Math.min(9999, (qty.get(item.product_id) ?? 0) + item.quantity));
          }
          const ids = [...qty.keys()];
          const found = ids.length ? (await db.query(
            'SELECT id, kind, name, price_agorot, appointment_duration_minutes ' +
            'FROM products WHERE is_active AND id = ANY($1::uuid[])',
            [ids],
          )).rows : [];
          if (found.length !== ids.length) throw new HttpError(400, 'unknown_product');
          const kinds = new Set(found.map((item) => item.kind));
          if (kinds.size > 1) throw new HttpError(400, 'mixed_catalog_types');

          const domain = found[0]?.kind === 'service' ? 'services' : 'products';
          if ((body.route === 'reserve' || (body.route === 'whatsapp' && domain === 'services')) && domain !== 'services') {
            throw new HttpError(400, 'invalid_contact_flow');
          }
          if (body.route === 'site' && domain !== 'products') throw new HttpError(400, 'invalid_contact_flow');
          if (body.route !== 'reserve' && body.appointment_at) throw new HttpError(400, 'invalid_contact_flow');

          const legacyCalendarServices = !biz.config?.contact_options && domain === 'services' && Boolean((await db.query(
            "SELECT EXISTS (SELECT 1 FROM products WHERE id = ANY($1::uuid[]) AND kind = 'service' AND is_active AND COALESCE(booking_mode, CASE WHEN requires_appointment THEN 'free_datetime' ELSE 'none' END) <> 'none') AS enabled",
            [ids],
          )).rows[0]?.enabled);
          const routeSettings = resolveLeadRoute(biz.config, body.route, domain, legacyCalendarServices);
          if (!routeSettings.routeEnabled) throw new HttpError(403, 'route_disabled');
          if (body.route === 'whatsapp' && !biz.whatsapp_number) throw new HttpError(409, 'whatsapp_not_configured');

          let total = 0, priced = 0, hasQuote = false;
          for (const item of found) {
            const quantity = qty.get(item.id)!;
            if (item.price_agorot === null) hasQuote = true;
            else { total += item.price_agorot * quantity; priced++; }
          }
          if (total > 2_000_000_000) throw new HttpError(400, 'total_too_large');
          const estimated = priced > 0 ? total : null;

          const serviceDurationMinutes = domain === 'services'
            ? found.reduce((sum, item) => sum + (item.appointment_duration_minutes ?? 30) * (qty.get(item.id) ?? 1), 0)
            : 0;
          if (body.route === 'reserve') {
            if (!body.customer_phone) throw new HttpError(400, 'contact_required');
            if (!body.appointment_at) throw new HttpError(400, 'appointment_required');
            if (serviceDurationMinutes <= 0 || serviceDurationMinutes > 480) throw new HttpError(400, 'invalid_appointment_time');

            // Match the lock used by POST /appointment-blocks. This closes the
            // race where a block is created after availability was checked but
            // before the customer reservation is inserted.
            await db.query(
              "SELECT pg_advisory_xact_lock(hashtextextended(app.current_tenant_id()::text, 724110))",
            );
            const blocked = await db.query(
              `SELECT EXISTS (
                 SELECT 1 FROM appointment_blocks b
                  WHERE tstzrange(b.start_at, b.end_at, '[)') &&
                        tstzrange(($1::timestamp AT TIME ZONE $2),
                          (($1::timestamp AT TIME ZONE $2) + ($3::int * interval '1 minute')), '[)')
               ) AS blocked`,
              [body.appointment_at, biz.timezone, serviceDurationMinutes],
            );
            if (blocked.rows[0]?.blocked === true) {
              throw new HttpError(409, 'slot_blocked', 'המועד נחסם בינתיים. בחרו מועד אחר.');
            }

            const appointmentError = validateAppointmentSelection({
              needsAppointment: true,
              appointmentAt: body.appointment_at,
              durationMinutes: serviceDurationMinutes,
              openingHoursDays: biz.config?.opening_hours?.days,
              timezone: biz.timezone,
            });
            if (appointmentError === 'appointment_required') throw new HttpError(400, 'appointment_required');
            if (appointmentError) throw new HttpError(400, 'invalid_appointment_time');
          }

          const shouldCreateLead = routeSettings.createLead;
          const status = body.route === 'whatsapp' ? 'whatsapp_initiated' : 'pending_approval';
          let leadId: string | null = null;
          if (shouldCreateLead) {
            const lead = await db.query(
              `INSERT INTO leads (tenant_id, customer_name, customer_phone, customer_email, message,
                                  submission_channel, status, estimated_total_agorot, metadata, idempotency_key)
               VALUES (app.current_tenant_id(), $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::uuid)
               ON CONFLICT DO NOTHING
               RETURNING id`,
              [body.customer_name ?? null, body.customer_phone ?? null, body.customer_email ?? null,
               body.message ?? null, body.route === 'whatsapp' ? 'whatsapp' : 'site', status, estimated,
               JSON.stringify({
                 domain,
                 action: body.route,
                 has_quote_items: hasQuote,
                 ...(body.route === 'reserve' ? {
                   appointment_duration_minutes: serviceDurationMinutes,
                   appointment_at: body.appointment_at,
                 } : {}),
               }), body.idempotency_key ?? null],
            );
            if (!lead.rows[0]) {
              const existing = body.idempotency_key ? (await db.query(
                'SELECT id, status, estimated_total_agorot, metadata FROM leads WHERE idempotency_key = $1',
                [body.idempotency_key],
              )).rows[0] : null;
              if (!existing) throw new HttpError(409, 'duplicate_request');
              const duplicateAppointment = body.route === 'reserve' ? (await db.query(
                "SELECT id, status FROM appointments WHERE tenant_id = app.current_tenant_id() AND idempotency_key = $1",
                [body.idempotency_key],
              )).rows[0] : null;
              const duplicatePushToken = duplicateAppointment?.status === 'reserved'
                ? await issuePushCapability(db, req.tenantId, 'appointment', duplicateAppointment.id)
                : null;
              return {
                lead_id: existing.id, route: body.route, status: existing.status,
                ...(duplicatePushToken ? { push_capability_token: duplicatePushToken } : {}),
                estimated_total_agorot: existing.estimated_total_agorot,
                has_quote_items: existing.metadata?.has_quote_items === true,
                duplicate: true,
                appointment_reserved: duplicateAppointment?.status === 'reserved',
                crm_record_created: true,
                success_message: body.route === 'reserve'
                  ? 'התור כבר נשמר ביומן. לשינוי או לביטול יש לפנות לעסק ישירות.'
                  : body.route === 'whatsapp'
                    ? 'הפנייה כבר תועדה. יש לשלוח את הודעת WhatsApp כדי להשלים את הפנייה.'
                    : 'הפנייה כבר נשמרה בהצלחה.',
              };
            }
            leadId = lead.rows[0].id as string;
            if (found.length) {
              await db.query(
                `INSERT INTO lead_items (tenant_id, lead_id, product_id, item_name, unit_price_agorot, quantity)
                 SELECT app.current_tenant_id(), $1, x.pid, x.nm, x.pr, x.q
                   FROM unnest($2::uuid[], $3::text[], $4::int[], $5::int[]) AS x(pid, nm, pr, q)`,
                [leadId, found.map((item) => item.id), found.map((item) => item.name),
                 found.map((item) => item.price_agorot), found.map((item) => qty.get(item.id)!)],
              );
            }
          }

          let appointmentId: string | null = null;
          let appointmentCreated = false;
          if (body.route === 'reserve') {
            try {
              const inserted = await db.query(
                `INSERT INTO appointments
                   (tenant_id, lead_id, service_id, service_name, customer_phone, start_at, end_at, source, status, idempotency_key)
                 VALUES
                   (app.current_tenant_id(), $1, $2, $3, $4,
                    ($5::timestamp AT TIME ZONE $6),
                    (($5::timestamp AT TIME ZONE $6) + ($7::int * interval '1 minute')),
                    'website', 'reserved', $8::uuid)
                 ON CONFLICT (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
                 RETURNING id`,
                [leadId, found.length === 1 ? found[0].id : null,
                 found.map((item) => item.name).join(' + '), body.customer_phone,
                 body.appointment_at, biz.timezone, serviceDurationMinutes, body.idempotency_key],
              );
              if (inserted.rows[0]) {
                appointmentId = inserted.rows[0].id as string;
                appointmentCreated = true;
              } else {
                const existingAppointment = (await db.query(
                  "SELECT id, status FROM appointments WHERE tenant_id = app.current_tenant_id() AND idempotency_key = $1",
                  [body.idempotency_key],
                )).rows[0];
                if (!existingAppointment || existingAppointment.status !== 'reserved') throw new HttpError(409, 'duplicate_request');
                appointmentId = existingAppointment.id as string;
              }
            } catch (error) {
              if ((error as { code?: string }).code === '23P01' || (error as { code?: string }).code === '23505') {
                throw new HttpError(409, 'slot_taken', 'המועד נתפס בינתיים. בחרו מועד אחר.');
              }
              throw error;
            }
          }

          let pushCapabilityToken: string | null = null;
          let pushEventId: string | null = null;
          if (appointmentId) {
            pushCapabilityToken = await issuePushCapability(db, req.tenantId, 'appointment', appointmentId);
            if (appointmentCreated) {
              pushEventId = await enqueuePushEvent(db, req.tenantId, {
                audience: 'seller',
                eventType: 'seller.appointment_created',
                targetType: 'appointment',
                targetId: appointmentId,
                payload: { title: 'BTime', body: 'נקבע תור חדש', url: '/account' },
              });
            }
          }

          const out: Record<string, unknown> = {
            ...(pushCapabilityToken ? { push_capability_token: pushCapabilityToken } : {}),
            ...(pushEventId ? { push_event_id: pushEventId } : {}),
            ...(leadId ? { lead_id: leadId, status } : {}),
            route: body.route,
            ...(shouldCreateLead ? { estimated_total_agorot: estimated, has_quote_items: hasQuote } : {}),
            appointment_reserved: Boolean(appointmentId),
            crm_record_created: Boolean(leadId),
          };

          if (body.route === 'reserve') {
            out.success_message = 'התור נקבע ונשמר ביומן העסק בהצלחה. לשינוי או לביטול יש לפנות ישירות לעסק; לא ניתן לבטל דרך האתר.';
          } else if (body.route === 'site') {
            out.success_message = 'הפנייה נשלחה בהצלחה, נחזור אליך בהקדם.';
          } else {
            const quoteLabel = biz.config?.catalog?.quote_label ?? DEFAULT_QUOTE_LABEL;
            const itemsText = found.map((item) => {
              const quantity = qty.get(item.id)!;
              const price = item.price_agorot === null ? quoteLabel : ils(item.price_agorot * quantity);
              const duration = item.kind === 'service' ? ` · משך השירות: ${(item.appointment_duration_minutes ?? 30) * quantity} דקות` : '';
              return `• ${item.name} × ${quantity}${duration} — ${price}`;
            }).join('\n');
            const totalText = estimated === null ? quoteLabel : hasQuote ? `${ils(estimated)} + ${quoteLabel}` : ils(estimated);
            const intro = String(flow.whatsapp_intro ?? '').trim() || (domain === 'services' ? 'שלום, אשמח לקבל פרטים נוספים לגבי השירות:' : DEFAULT_WA_INTRO);
            const messageLines = [intro, '', domain === 'services' ? 'שירותים שנבחרו:' : 'פריטים שנבחרו:', itemsText || '-'];
            if (body.customer_name) messageLines.push(`שם: ${body.customer_name}`);
            if (body.customer_phone) messageLines.push(`טלפון: ${toLocalPhone(body.customer_phone)}`);
            messageLines.push('', `סכום משוער: ${totalText}`);
            if (body.message) messageLines.push('', `הערה: ${body.message}`);
            out.whatsapp_url = `https://wa.me/${String(biz.whatsapp_number).replace(/\D/g, '').replace(/^0/, '')}?text=${encodeURIComponent(messageLines.join('\n'))}`;
            out.success_message = shouldCreateLead
              ? 'הפנייה תועדה במערכת. יש לשלוח את הודעת WhatsApp כדי להשלים את הפנייה.'
              : 'הודעת WhatsApp מוכנה. יש לשלוח אותה כדי לפנות לעסק.';
          }
          return out;
        });

        const response = result as Record<string, unknown>;
        if (response.appointment_reserved === true) {
          void processGoogleCalendarJobs(req.tenantId, 5).catch((error) =>
            req.log.warn({ err: error }, 'Google Calendar sync after public reservation failed'));
        }
        const pushEventId = typeof response.push_event_id === 'string' ? response.push_event_id : null;
        delete response.push_event_id;
        if (pushEventId) await dispatchPushEventAfterCommit(req.tenantId, pushEventId, req.log);
        return reply.code(201).send(response);
      },
    );
  };