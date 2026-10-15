import type { MetadataRoute } from 'next';
import { notFound } from 'next/navigation';
import type { ManageBusiness } from '@/lib/types';

export const dynamic = 'force-dynamic';

const TOKEN_RE = /^[A-Za-z0-9_-]{43,128}$/;

export default async function manifest({ params }: { params: Promise<{ token: string }> }): Promise<MetadataRoute.Manifest> {
  const { token } = await params;
  if (!TOKEN_RE.test(token)) notFound();

  const response = await fetch(`${process.env.API_URL}/api/manage/${token}/business`, { cache: 'no-store' });
  if (response.status === 404) notFound();
  if (!response.ok) throw new Error(`backend ${response.status}`);
  const biz = await response.json() as ManageBusiness;
  const startUrl = `/manage/${token}`;

  return {
    id: startUrl,
    name: `ניהול ${biz.name}`,
    short_name: `ניהול ${biz.name}`.slice(0, 24),
    description: `אזור הניהול של ${biz.name}`,
    lang: 'he',
    dir: 'rtl',
    start_url: startUrl,
    scope: startUrl,
    display: 'standalone',
    background_color: biz.config?.branding?.colors?.background || '#ffffff',
    theme_color: biz.config?.branding?.colors?.primary || '#17324d',
    icons: [
      { src: '/pwa-192.svg', sizes: '192x192', type: 'image/svg+xml', purpose: 'any' },
      { src: '/pwa-512.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any' },
    ],
  };
}
