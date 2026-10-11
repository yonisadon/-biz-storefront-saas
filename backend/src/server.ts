import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { env } from './config';
import { HttpError } from './errors';
import { resolveByHost, resolveBySlug } from './tenant';
import { publicRoutes } from './routes/public';
import { manageRoutes } from './routes/manage';

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

  app.get('/health', async () => ({ ok: true }));

  await app.register(publicRoutes(resolveBySlug), { prefix: '/api/biz/:slug' });
  await app.register(publicRoutes(resolveByHost), { prefix: '/api/site' });
  await app.register(manageRoutes, { prefix: '/api/manage/:token' });

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
