import 'server-only';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import type { PublicPayload } from './types';
const API = process.env.API_URL!;
const SLUG_RE = /^(?:_site|[a-z0-9]+(?:-[a-z0-9]+)*)$/;
export type Ctx = { path: string; host?: string; origin: string; base: string };
export async function getCtx(slug: string): Promise<Ctx> {
  if (!SLUG_RE.test(slug)) notFound();
  if (slug === '_site') {
    const h = await headers();
    const rawHost = (
      h.get('x-original-host') ??
      h.get('host') ??
      h.get('x-forwarded-host') ??
      ''
    ).split(',')[0].trim();
    let host = '';
    try {
      host = new URL(rawHost.includes('://') ? rawHost : `https://${rawHost}`).hostname
        .toLowerCase().replace(/\.$/, '');
    } catch {
      notFound();
    }
    if (!host) notFound();
    return { path: '/api/site', host, origin: `https://${host}`, base: '' };
  }
  const h = await headers();
  const forwardedHost = (h.get('x-forwarded-host') ?? '').split(',')[0].trim();
  const requestHost = (forwardedHost || h.get('host') || '').split(',')[0].trim();
  const forwardedProto = (h.get('x-forwarded-proto') ?? '').split(',')[0].trim();
  let origin = process.env.PUBLIC_BASE_URL ?? '';
  if (requestHost) {
    try {
      origin = new URL(`${forwardedProto || 'https'}://${requestHost}`).origin;
    } catch {
      // Keep the configured public base URL as a safe fallback.
    }
  }
  if (!origin) throw new Error('public_origin_unavailable');
  return { path: `/api/biz/${slug}`, origin: origin.replace(/\/$/, ''), base: `/biz/${slug}` };
}
async function get<T>(ctx: Ctx, sub: string, revalidate: number): Promise<T | null> {
  const endpoint = `${ctx.path}${sub}`;
  if (!API) {
    console.error('[btime-api] API_URL is not configured', { endpoint });
    throw new Error('API_URL_NOT_CONFIGURED');
  }
  const qs = ctx.host ? `?h=${encodeURIComponent(ctx.host)}` : '';
  let res: Response;
  try {
    res = await fetch(`${API.replace(/\\/+$/, '')}${endpoint}${qs}`, {
      headers: ctx.host ? { 'x-original-host': ctx.host, 'x-forwarded-host': ctx.host } : {},
      next: { revalidate },
    });
  } catch (error) {
    console.error('[btime-api] request failed', {
      endpoint,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  if (res.status === 404) return null;
  if (!res.ok) {
    console.error('[btime-api] backend returned non-success status', { endpoint, status: res.status });
    throw new Error(`BACKEND_HTTP_${res.status}:${endpoint}`);
  }
  return res.json() as Promise<T>;
}
export const getStorefront = (ctx: Ctx) => get<PublicPayload>(ctx, '', 30);
export const getLegal = (ctx: Ctx, doc: string) =>
  get<{ doc: string; custom_text: string | null }>(ctx, `/legal/${doc}`, 300);
