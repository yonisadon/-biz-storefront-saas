import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart'; // <-- אימפורט חדש
import { ZodError } from 'zod';
import { env } from './config';
import { HttpError } from './errors';
import { resolveByHost, resolveBySlug } from './tenant';
import { publicRoutes } from './routes/public';
import { manageRoutes } from './routes/manage';
import { mediaRoutes } from './routes/media';
import { adminRoutes } from './routes/admin';

// Management tokens are secrets: keep them out of logs
const redactUrl = (url: string) => url.replace(/(\/api\/manage\/)[^/?#]+/, '$1[redacted]');

const CONSTRAINT_MESSAGES: Record<string, string> = {
  chk_whatsapp_route_needs_number: 'WhatsApp route cannot be enabled without a WhatsApp number',
  chk_at_least_one_order_route: 'At least one order route must stay enabled',
};

export async function buildServer() {
  const app = Fastify({
    trustProxy: true, // Railway sits behind a proxy: needed for correct client IPs
    bodyLimit: 1_000_000,
    logger: {
      level: 'info',
      serializers: { req: (req: any) => ({ method: req.method, url: redactUrl(req.url) }) },
    },
  });

  app.decorateRequest('tenantId', '');
  await app.register(cors, { origin: env.CORS_ORIGINS ? env.CORS_ORIGINS.split(',') : false });
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });

  // <-- הוספת 2 השורות האלו מיד אחרי rateLimit:
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 5 } });
  await app.register(mediaRoutes);

  app.get('/health', async () => ({ ok: true }));

  await app.register(publicRoutes(resolveBySlug), { prefix: '/api/biz/:slug' });
  await app.register(publicRoutes(resolveByHost), { prefix: '/api/site' });
  await app.register(manageRoutes, { prefix: '/api/manage/:token' });
  await app.register(adminRoutes, { prefix: '/api/admin' });

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: 'validation_error',
        issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: err.code, message: err.message, details: err.details });
    }
    if (err.code === '23514') { // CHECK violation
      return reply.code(422).send({
        error: 'constraint_violation',
        message: CONSTRAINT_MESSAGES[err.constraint] ?? 'Value rejected by database constraint',
      });
    }

    // <-- הוספת טיפול בשגיאות קבצים והתנגשויות לפני השורות הכלליות:
    if (err.code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.code(413).send({ error: 'file_too_large' });
    }
    if (err.code === '23505') { // unique violation
      return reply.code(409).send({ error: 'conflict', message: 'Concurrent change, please retry' });
    }

    if (err.statusCode && err.statusCode < 500) { // 404 route, 429 rate limit, bad JSON...
      return reply.code(err.statusCode).send({ error: err.code ?? 'bad_request', message: err.message });
    }
    req.log.error(err);
    return reply.code(500).send({ error: 'internal_error' });
  });

  return app;
}

buildServer()
  .then((app) => app.listen({ port: env.PORT, host: '0.0.0.0' }))
  .catch((err) => { console.error(err); process.exit(1); });