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
    const rawHost = (h.get('x-forwarded-host') ?? h.get('host') ?? '').split(',')[0].trim();
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
  return { path: `/api/biz/${slug}`, origin: process.env.PUBLIC_BASE_URL!, base: `/biz/${slug}` };
}
async function get<T>(ctx: Ctx, sub: string, revalidate: number): Promise<T | null> {
  const qs = ctx.host ? `?h=${encodeURIComponent(ctx.host)}` : '';
  const res = await fetch(`${API}${ctx.path}${sub}${qs}`, {
    headers: ctx.host ? { 'x-original-host': ctx.host, 'x-forwarded-host': ctx.host } : {},
    next: { revalidate },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`backend ${res.status}`);
  return res.json() as Promise<T>;
}
export const getStorefront = (ctx: Ctx) => get<PublicPayload>(ctx, '', 30);
export const getLegal = (ctx: Ctx, doc: string) =>
  get<{ doc: string; custom_text: string | null }>(ctx, `/legal/${doc}`, 300);