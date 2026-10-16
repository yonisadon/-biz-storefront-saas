import type { FastifyPluginAsync } from 'fastify';
import sharp from 'sharp';
import { storage } from '../storage';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const TENANT_RE = new RegExp(`^${UUID}$`);
const FILE_RE = new RegExp(`^${UUID}(?:\\.og)?\\.jpg$`);
const ICON_FILE_RE = new RegExp(`^(${UUID})\\.icon-(192|512)\\.png$`);

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export const mediaRoutes: FastifyPluginAsync = async (app) => {
  // rateLimit:false matters: Next's image optimizer fetches from ONE server IP,
  // so a per-IP limit would throttle every visitor of every storefront.
  app.get('/media/:tenantId/:file', { config: { rateLimit: false } }, async (req, reply) => {
    const { tenantId, file } = req.params as { tenantId: string; file: string };
    if (!TENANT_RE.test(tenantId)) return reply.code(404).send();

    const iconMatch = ICON_FILE_RE.exec(file);
    if (iconMatch) {
      const [, assetId, sizeText] = iconMatch;
      const source = await storage.get(`${tenantId}/${assetId}.jpg`);
      if (!source) return reply.code(404).send();
      const size = Number(sizeText);
      const input = await streamToBuffer(source.stream);
      const output = await sharp(input)
        .resize(size, size, { fit: 'cover', position: sharp.strategy.attention })
        .png()
        .toBuffer();
      return reply
        .type('image/png')
        .header('cache-control', 'public, max-age=31536000, immutable')
        .header('x-content-type-options', 'nosniff')
        .header('content-security-policy', "default-src 'none'")
        .header('cross-origin-resource-policy', 'cross-origin')
        .header('content-length', output.length)
        .send(output);
    }

    if (!FILE_RE.test(file)) return reply.code(404).send();
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
