import { createHash } from 'node:crypto';
import type { preHandlerAsyncHookHandler } from 'fastify';
import { pool } from './db';
import { HttpError } from './errors';

declare module 'fastify' {
  interface FastifyRequest { tenantId: string }
}

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{43,128}$/; // 32 random bytes as base64url = 43 chars

export const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest();

const SESSION_COOKIE = 'btime_session';

function platformSessionHash(req: import('fastify').FastifyRequest): Buffer | null {
  const raw = String(req.headers.cookie ?? '');
  for (const item of raw.split(';')) {
    const [name, ...parts] = item.trim().split('=');
    if (name !== SESSION_COOKIE) continue;
    try {
      const token = decodeURIComponent(parts.join('='));
      return /^[A-Za-z0-9_-]{43}$/.test(token) ? sha256(token) : null;
    } catch {
      return null;
    }
  }
  return null;
}

const TRANSIENT_DB_CODES = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH',
  '57P03', '08001', '08006',
]);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function scalar(sql: string, params: unknown[]): Promise<string | null> {
  // Railway may wake PostgreSQL after the API container has already started.
  // Retry only transient connection/startup failures; never mask SQL/schema errors.
  for (let attempt = 0; ; attempt++) {
    try {
      const { rows } = await pool.query(sql, params);
      return rows[0]?.t ?? null;
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (!code || !TRANSIENT_DB_CODES.has(code) || attempt >= 6) throw err;
      const delayMs = Math.min(1000 * 2 ** attempt, 5000);
      console.warn(`Registry database not ready (attempt ${attempt + 1}/7); retrying in ${delayMs}ms.`);
      await sleep(delayMs);
    }
  }
}

// Public site: /api/biz/:slug/...
export const resolveBySlug: preHandlerAsyncHookHandler = async (req) => {
  const slug = String((req.params as { slug?: string }).slug ?? '').toLowerCase();
  if (!SLUG_RE.test(slug)) throw new HttpError(404, 'not_found');
  const id = await scalar('SELECT app.resolve_tenant_by_slug($1) AS t', [slug]);
  if (!id) throw new HttpError(404, 'not_found');
  req.tenantId = id;
};

// Public site on a verified custom domain: /api/site/...
export const resolveByHost: preHandlerAsyncHookHandler = async (req) => {
  const raw = String(req.headers['x-original-host'] ?? req.headers['x-forwarded-host'] ?? req.headers.host ?? '').split(',')[0].trim();
  let host = '';
  try {
    host = new URL(raw.includes('://') ? raw : `https://${raw}`).hostname
      .toLowerCase().replace(/\.$/, '');
  } catch {
    throw new HttpError(404, 'not_found');
  }
  if (!host) throw new HttpError(404, 'not_found');
  const id = await scalar('SELECT app.resolve_tenant_by_domain($1) AS t', [host]);
  if (!id) throw new HttpError(404, 'not_found');
  req.tenantId = id;
};

// Seller panel: /api/manage/:token/...  (only the SHA-256 reaches the DB)
export const resolveByToken: preHandlerAsyncHookHandler = async (req) => {
  const token = String((req.params as { token?: string }).token ?? '');
  if (!TOKEN_RE.test(token)) throw new HttpError(404, 'not_found');
  const tokenHash = sha256(token);
  const id = await scalar('SELECT app.resolve_tenant_by_token($1) AS t', [tokenHash]);
  if (!id) throw new HttpError(404, 'not_found'); // same answer for invalid/expired/revoked

  // A permanent link remains sufficient only until the business is claimed.
  // After that, every management API requires the matching owner's live session.
  const authorizedId = await scalar(
    'SELECT app.authorize_tenant_management($1, $2) AS t',
    [tokenHash, platformSessionHash(req)],
  );
  if (!authorizedId) throw new HttpError(401, 'management_login_required');
  req.tenantId = authorizedId;
};
