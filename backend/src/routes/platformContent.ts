import type { FastifyPluginAsync } from 'fastify';
import pg from 'pg';
import { env } from '../config';
import { HttpError } from '../errors';

let contentPool: pg.Pool | undefined;
let contactPool: pg.Pool | undefined;

function pool(): pg.Pool {
  if (!contentPool) {
    contentPool = new pg.Pool({
      connectionString: env.APP_DATABASE_URL,
      max: 4,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ssl: env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    });
    contentPool.on('error', (error) => console.error('platform content registry pool error', error.message));
  }
  return contentPool;
}

function publicContactPool(): pg.Pool {
  if (!env.SUPERADMIN_DATABASE_URL) throw new HttpError(503, 'account_service_not_configured');
  if (!contactPool) {
    contactPool = new pg.Pool({
      connectionString: env.SUPERADMIN_DATABASE_URL,
      max: 2,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ssl: env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    });
    contactPool.on('error', (error) => console.error('platform public contact pool error', error.message));
  }
  return contactPool;
}

export const platformContentRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onClose', async () => {
    if (contentPool) {
      const current = contentPool;
      contentPool = undefined;
      await current.end();
    }
    if (contactPool) {
      const current = contactPool;
      contactPool = undefined;
      await current.end();
    }
  });

  app.get('/contact', async (_request, reply) => {
    reply.header('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
    const result = await publicContactPool().query(
      "SELECT email, phone FROM public.platform_users WHERE role = 'super_admin' AND disabled_at IS NULL ORDER BY created_at ASC LIMIT 1",
    );
    const row = result.rows[0] as { email?: string; phone?: string } | undefined;
    return { email: row?.email ?? null, phone: row?.phone ?? null };
  });

  app.get('/marketing', async () => {
    try {
      const result = await pool().query(
        "SELECT content, updated_at FROM public.platform_content WHERE content_key = 'marketing_page' LIMIT 1",
      );
      return { content: result.rows[0]?.content ?? null, updated_at: result.rows[0]?.updated_at ?? null };
    } catch (error) {
      if ((error as { code?: string }).code === '42P01') {
        throw new HttpError(503, 'platform_content_not_migrated');
      }
      throw error;
    }
  });
};
