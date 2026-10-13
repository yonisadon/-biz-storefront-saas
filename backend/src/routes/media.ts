import type { FastifyPluginAsync } from 'fastify';
import { storage } from '../storage';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const TENANT_RE = new RegExp(`^${UUID}$`);
const FILE_RE = new RegExp(`^${UUID}(\\.og)?\\.jpg$`);

export const mediaRoutes: FastifyPluginAsync = async (app) => {
  // rateLimit:false matters: Next's image optimizer fetches from ONE server IP,
  // so a per-IP limit would throttle every visitor of every storefront.
  app.get('/media/:tenantId/:file', { config: { rateLimit: false } }, async (req, reply) => {
    const { tenantId, file } = req.params as { tenantId: string; file: string };
    if (!TENANT_RE.test(tenantId) || !FILE_RE.test(file)) return reply.code(404).send();

    const obj = await storage.get(`${tenantId}/${file}`);
    if (!obj) return reply.code(404).send();

    reply
      .type('image/jpeg')
      .header('cache-control', 'public, max-age=31536000, immutable')
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'")
      .header('cross-origin-resource-policy', 'cross-origin');
    if (obj.contentLength) reply.header('content-length', obj.contentLength);
    return reply.send(obj.stream);
  });
};