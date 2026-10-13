import type { FastifyPluginAsync, preHandlerAsyncHookHandler } from 'fastify';
import type pg from 'pg';
import { env } from '../config';
import { withTenant } from '../db';
import { HttpError } from '../errors';
import { LeadInput, LegalDoc } from '../schemas';
import { ils, isOpenNow, mediaUrl, renderTemplate, toLocalPhone } from '../util';
import { ogKey as ogVariant } from '../storage'; // <-- 1. הוספת אימפורט זה

const DEFAULT_WA_TEMPLATE =
  'שלום, שמי {customer_name}, טלפון: {customer_phone}\nהזמנה:\n{items}\nסכום משוער: {estimated_total}\n{message}';
const DEFAULT_QUOTE_LABEL = 'להצעת מחיר';

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
  const hours = cfg.opening_hours ?? {};

  const products = (await db.query(
    `SELECT p.id, p.kind, p.name, p.description, p.price_agorot, m.storage_key, m.width, m.height
       FROM products p
       LEFT JOIN media_assets m ON m.tenant_id = p.tenant_id AND m.id = p.image_asset_id
      WHERE p.is_active
      ORDER BY p.sort_order, p.created_at`,
  )).rows.map((r) => ({
    id: r.id, kind: r.kind, name: r.name, description: r.description,
    price_agorot: r.price_agorot, // null => quote
    image: r.storage_key
      ? { url: mediaUrl(env.MEDIA_BASE_URL, r.storage_key), width: r.width, height: r.height }
      : null,
  }));

  const galleryRows = (await db.query(
    `SELECT pi.position, pi.alt_text, pi.caption, m.storage_key, m.width, m.height
       FROM portfolio_images pi
       JOIN media_assets m ON m.tenant_id = pi.tenant_id AND m.id = pi.asset_id
      ORDER BY pi.position`,
  )).rows;
  const gallery = galleryRows.map((r) => ({
    url: mediaUrl(env.MEDIA_BASE_URL, r.storage_key),
    alt: r.alt_text, caption: r.caption, width: r.width, height: r.height,
  }));

  // Open Graph data (the frontend/SSR layer renders the <meta> tags from this)
  let ogKey: string | null = null;
  if (cfg.seo?.og_image_asset_id) {
    const r = await db.query('SELECT storage_key FROM media_assets WHERE id = $1', [cfg.seo.og_image_asset_id]);
    ogKey = r.rows[0]?.storage_key ?? null;
  }
  ogKey ??= galleryRows[0]?.storage_key ?? null;

  const openNow = isOpenNow(hours, biz.timezone);
  return {
    business: {
      name: biz.name, slug: biz.slug, phone: biz.phone,
      whatsapp_number: biz.whatsapp_number, email: biz.email,
      locale: biz.locale, timezone: biz.timezone,
    },
    about: biz.about_text,                       // null => component hidden
    branding: cfg.branding ?? {},
    order_flow: {
      whatsapp_enabled: flow.whatsapp_enabled === true,
      site_inquiry_enabled: flow.site_inquiry_enabled === true,
    },
    opening_hours: {
      days: hours.days ?? null,
      open_now: openNow,
      show_out_of_hours_banner: hours.out_of_hours_banner?.enabled !== false && openNow === false,
      banner_message: hours.out_of_hours_banner?.message ?? null,
    },
    catalog: { quote_label: cfg.catalog?.quote_label ?? DEFAULT_QUOTE_LABEL, items: products },
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

    // Config + catalog + gallery in one round trip
    app.get('/', async (req) => withTenant(req.tenantId, buildPublicPayload));

    // Legal texts are fetched separately (can be large). null => use platform default.
    app.get('/legal/:doc', async (req) => {
      const doc = LegalDoc.parse((req.params as { doc: string }).doc);
      return withTenant(req.tenantId, async (db) => {
        const biz = await loadBusiness(db);
        return { doc, custom_text: biz.config?.legal?.[doc]?.custom_text ?? null };
      });
    });

    // Submit a lead: Route A (whatsapp) or Route B (site)
    app.post(
      '/leads',
      { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
      async (req, reply) => {
        const body = LeadInput.parse(req.body);

        // Honeypot: pretend success, store nothing
        if (body.company_website) return reply.code(201).send({ ok: true });

        const result = await withTenant(req.tenantId, async (db) => {
          const biz = await loadBusiness(db);
          const flow = biz.config?.order_flow ?? {};
          const enabled = body.route === 'whatsapp'
            ? flow.whatsapp_enabled === true
            : flow.site_inquiry_enabled === true;
          if (!enabled) throw new HttpError(403, 'route_disabled');

          // Merge duplicate lines; prices/names come from the DB, never the client
          const qty = new Map<string, number>();
          for (const it of body.items) {
            qty.set(it.product_id, Math.min(9999, (qty.get(it.product_id) ?? 0) + it.quantity));
          }
          const ids = [...qty.keys()];
          const found = ids.length
            ? (await db.query(
                'SELECT id, name, price_agorot FROM products WHERE is_active AND id = ANY($1::uuid[])',
                [ids],
              )).rows
            : [];
          if (found.length !== ids.length) throw new HttpError(400, 'unknown_product');

          let total = 0, priced = 0, hasQuote = false;
          for (const p of found) {
            const q = qty.get(p.id)!;
            if (p.price_agorot === null) hasQuote = true;
            else { total += p.price_agorot * q; priced++; }
          }
          if (total > 2_000_000_000) throw new HttpError(400, 'total_too_large');
          const estimated = priced > 0 ? total : null;

          const status = body.route === 'whatsapp' ? 'whatsapp_initiated' : 'pending_approval';
          const lead = await db.query(
            `INSERT INTO leads (tenant_id, customer_name, customer_phone, customer_email, message,
                                submission_channel, status, estimated_total_agorot, metadata)
             VALUES (app.current_tenant_id(), $1, $2, $3, $4, $5, $6, $7, $8::jsonb)
             RETURNING id`,
            [body.customer_name, body.customer_phone, body.customer_email ?? null,
             body.message ?? null, body.route, status, estimated,
             JSON.stringify({ has_quote_items: hasQuote })],
          );
          const leadId: string = lead.rows[0].id;

          if (found.length) {
            await db.query(
              `INSERT INTO lead_items (tenant_id, lead_id, product_id, item_name, unit_price_agorot, quantity)
               SELECT app.current_tenant_id(), $1, x.pid, x.nm, x.pr, x.q
                 FROM unnest($2::uuid[], $3::text[], $4::int[], $5::int[]) AS x(pid, nm, pr, q)`,
              [leadId, found.map((p) => p.id), found.map((p) => p.name),
               found.map((p) => p.price_agorot), found.map((p) => qty.get(p.id)!)],
            );
          }

          const out: Record<string, unknown> = {
            lead_id: leadId, route: body.route, status,
            estimated_total_agorot: estimated, has_quote_items: hasQuote,
          };

          if (body.route === 'site') {
            out.success_message = flow.site_success_message ?? 'הפנייה נשלחה בהצלחה, נחזור אליך בהקדם.';
          } else {
            const quoteLabel = biz.config?.catalog?.quote_label ?? DEFAULT_QUOTE_LABEL;
            const itemsText = found.map((p) => {
              const q = qty.get(p.id)!;
              const price = p.price_agorot === null ? quoteLabel : ils(p.price_agorot * q);
              return `• ${p.name} × ${q} — ${price}`;
            }).join('\n');
            const totalText = estimated === null ? quoteLabel
              : hasQuote ? `${ils(estimated)} + ${quoteLabel}` : ils(estimated);
            const text = renderTemplate(flow.whatsapp_message_template ?? DEFAULT_WA_TEMPLATE, {
              customer_name: body.customer_name,
              customer_phone: toLocalPhone(body.customer_phone),
              items: itemsText || '-',
              estimated_total: totalText,
              message: body.message ?? '',
            }).trim();
            out.whatsapp_url = `https://wa.me/${String(biz.whatsapp_number).slice(1)}?text=${encodeURIComponent(text)}`;
          }
          return out;
        });

        return reply.code(201).send(result);
      },
    );
  };