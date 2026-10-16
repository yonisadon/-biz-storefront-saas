import type { MetadataRoute } from 'next';
import { notFound } from 'next/navigation';
import type { ManageBusiness, MGalleryImage } from '@/lib/types';

export const dynamic = 'force-dynamic';

const TOKEN_RE = /^[A-Za-z0-9_-]{43,128}$/;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;
  if (!TOKEN_RE.test(token)) notFound();

  const baseUrl = `${process.env.API_URL}/api/manage/${token}`;
  const [businessResponse, galleryResponse] = await Promise.all([
    fetch(`${baseUrl}/business`, { cache: 'no-store' }),
    fetch(`${baseUrl}/gallery`, { cache: 'no-store' }),
  ]);
  if (businessResponse.status === 404 || galleryResponse.status === 404) notFound();
  if (!businessResponse.ok) throw new Error(`business backend ${businessResponse.status}`);
  if (!galleryResponse.ok) throw new Error(`gallery backend ${galleryResponse.status}`);

  const biz = await businessResponse.json() as ManageBusiness;
  const gallery = await galleryResponse.json() as MGalleryImage[];
  const branding = biz.config?.branding;
  const iconImage = gallery.find((image) => image.id === branding?.icon_gallery_image_id)
    ?? gallery.find((image) => image.id === branding?.hero_gallery_image_id)
    ?? gallery[0];
  const startUrl = `/manage/${token}`;

  const fallbackIcons: MetadataRoute.Manifest['icons'] = [
    { src: '/pwa-192.svg', sizes: '192x192', type: 'image/svg+xml', purpose: 'any' },
    { src: '/pwa-512.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any' },
  ];

  const manifest: MetadataRoute.Manifest = {
    id: startUrl,
    name: `ניהול ${biz.name}`,
    short_name: `ניהול ${biz.name}`.slice(0, 24),
    description: `אזור הניהול של ${biz.name}`,
    lang: 'he',
    dir: 'rtl',
    start_url: startUrl,
    scope: startUrl,
    display: 'standalone',
    background_color: branding?.colors?.background || '#ffffff',
    theme_color: branding?.colors?.primary || '#17324d',
    // Do not offer the platform's generic house icon when the business has its own image.
    icons: iconImage?.url
      ? [{ src: iconImage.url, purpose: 'any' }, { src: iconImage.url, purpose: 'maskable' }]
      : fallbackIcons,
  };

  return Response.json(manifest, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
