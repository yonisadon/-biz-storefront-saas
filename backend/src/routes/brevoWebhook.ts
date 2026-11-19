import { timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import pg from 'pg';
import { env } from '../config';

let registryPool: pg.Pool | undefined;

function pool(): pg.Pool {
  if (!env.SUPERADMIN_DATABASE_URL) throw new Error('platform registry is not configured');
  if (!registryPool) {
    registryPool = new pg.Pool({
      connectionString: env.SUPERADMIN_DATABASE_URL,
      max: 2,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ssl: env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    });
    registryPool.on('error', (error) => console.error('Brevo webhook registry pool error', error.message));
  }
  return registryPool;
}

function tokenMatches(supplied: string): boolean {
  const expected = env.BREVO_WEBHOOK_TOKEN;
  if (!expected) return false;
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export const brevoWebhookRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onClose', async () => {
    if (registryPool) {
      const current = registryPool;
      registryPool = undefined;
      await current.end();
    }
  });

  app.post('/:token', async (req, reply) => {
    const token = String((req.params as { token: string }).token);
    if (!tokenMatches(token)) return reply.code(404).send();
    const event = req.body as Record<string, unknown> | null;
    const eventName = String(event?.event ?? '').toLowerCase();
    const providerMessageId = String(event?.['message-id'] ?? event?.messageId ?? '');
    if (!providerMessageId || providerMessageId.length > 500) return { received: true, updated: 0 };
    let result: pg.QueryResult;
    if (eventName === 'delivered') {
      result = await pool().query(
        `UPDATE public.platform_message_recipients
            SET email_status = 'accepted', email_delivered_at = COALESCE(email_delivered_at, now()), email_error = NULL
          WHERE email_provider_message_id = $1`,
        [providerMessageId],
      );
    } else if (eventName === 'opened') {
      result = await pool().query(
        `UPDATE public.platform_message_recipients
            SET email_status = 'accepted', email_delivered_at = COALESCE(email_delivered_at, now()),
                email_opened_at = COALESCE(email_opened_at, now()), email_error = NULL
          WHERE email_provider_message_id = $1`,
        [providerMessageId],
      );
    } else if (['hard_bounce', 'soft_bounce', 'blocked', 'invalid', 'spam'].includes(eventName)) {
      result = await pool().query(
        `UPDATE public.platform_message_recipients
            SET email_status = 'failed', email_error = $2
          WHERE email_provider_message_id = $1`,
        [providerMessageId, ('brevo_' + eventName).slice(0, 500)],
      );
    } else {
      return { received: true, updated: 0 };
    }
    return { received: true, updated: result.rowCount ?? 0 };
  });
};
