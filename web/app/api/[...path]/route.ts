import type { NextRequest } from 'next/server';

const API = process.env.API_URL!;
const MAX_BODY = 11 * 1024 * 1024; // 10MB image + multipart overhead

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const url = `${API}/api/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`;
  const headers = new Headers();
  const ct = req.headers.get('content-type'); // keeps the multipart boundary intact
  if (ct) headers.set('content-type', ct);
  // Needed only for the manually authenticated Super Admin screen.
  const authorization = req.headers.get('authorization');
  if (authorization) headers.set('authorization', authorization);
  const xff = req.headers.get('x-forwarded-for');
  if (xff) headers.set('x-forwarded-for', xff);
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (host) headers.set('x-forwarded-host', host);

  let body: ArrayBuffer | undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY) {
      return Response.json({ error: 'file_too_large' }, { status: 413 });
    }
    body = await req.arrayBuffer();
    if (body.byteLength > MAX_BODY) return Response.json({ error: 'file_too_large' }, { status: 413 });
  }

  const res = await fetch(url, { method: req.method, headers, body, cache: 'no-store' });
  return new Response(res.body, {
    status: res.status,
    headers: {
      'content-type': res.headers.get('content-type') ?? 'application/json',
      'cache-control': 'no-store',
    },
  });
}

export { proxy as GET, proxy as POST, proxy as PATCH, proxy as PUT, proxy as DELETE };