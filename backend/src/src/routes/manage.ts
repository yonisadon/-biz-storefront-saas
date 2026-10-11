import type { FastifyPluginAsync } from 'fastify';
import { withTenant } from '../db';
import { HttpError } from '../errors';
import { validateConfig } from '../configValidator';
import { BusinessPatch, LeadListQuery, LeadStatusPatch } from '../schemas';
import { resolveByToken } from '../tenant';

export const manageRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', resolveByToken);
  // The token lives in the URL: never cache, never leak via Referer
  app.addHook('onSend', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('Referrer-Policy', 'no-referrer');
  });

  // ---- Business profile ----
  app.get('/business', async (req) =>
    withTenant(req.tenantId, async (db) => {
      const biz = (await db.query(
        `SELECT name, slug, status, phone, whatsapp_number, email, about_text,
                locale, timezone, config
           FROM businesses WHERE id = app.current_tenant_id()`,
      )).rows[0];
      const domains = (await db.query(
        'SELECT domain, is_verified, is_primary FROM business_domains ORDER BY is_primary DESC, domain',
      )).rows;
      return { ...biz, domains };
    }));

  app.patch('/business', async (req) => {
    const patch = BusinessPatch.parse(req.body);

    return withTenant(req.tenantId, async (db) => {
      const cur = (await db.query(
        'SELECT config FROM businesses WHERE id = app.current_tenant_id() FOR UPDATE',
      )).rows[0];
      if (!cur) throw new HttpError(404, 'not_found');

      const sets: string[] = [];
      const vals: unknown[] = [];
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
      return r.rows[0];
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
                count(*) OVER() AS total
           FROM leads l
          WHERE ($1::text IS NULL OR l.status = $1)
          ORDER BY l.created_at DESC, l.id DESC
          LIMIT $2 OFFSET $3`,
        [q.status ?? null, q.limit, q.offset],
      );
      const total = rows[0] ? Number(rows[0].total) : 0;
      return {
        total, limit: q.limit, offset: q.offset,
        leads: rows.map(({ total: _t, ...lead }) => lead),
      };
    });
  });

  app.patch('/leads/:id', async (req) => {
    const id = (req.params as { id: string }).id;
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, 'not_found');
    const { status } = LeadStatusPatch.parse(req.body);
    return withTenant(req.tenantId, async (db) => {
      const r = await db.query(
        'UPDATE leads SET status = $1 WHERE id = $2 RETURNING id, status, updated_at',
        [status, id],
      );
      if (!r.rows[0]) throw new HttpError(404, 'not_found'); // also hit for other tenants' ids
      return r.rows[0];
    });
  });
};
