import type { MetadataRoute } from 'next';
import { notFound } from 'next/navigation';
import { getCtx, getStorefront } from '@/lib/api';

export const revalidate = 60;

function pwaIconUrl(url: string, size: number): string {
  return url.replace(/\.jpg(?:\?.*)?$/, '.icon-' + size + '.png');
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const ctx = await getCtx(slug);
  const data = await getStorefront(ctx);
  if (!data) notFound();

  const startUrl = ctx.base || '/';
  const iconImage = data.gallery.find((image) => image.id === data.branding?.icon_gallery_image_id)
    ?? data.gallery.find((image) => image.id === data.branding?.hero_gallery_image_id)
    ?? data.gallery[0];

  const fallbackIcons: MetadataRoute.Manifest['icons'] = [
    { src: '/pwa-192.svg', sizes: '192x192', type: 'image/svg+xml', purpose: 'any' },
    { src: '/pwa-512.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any' },
  ];
  const icons: MetadataRoute.Manifest['icons'] = iconImage?.url
    ? [192, 512].map((size) => ({
        src: pwaIconUrl(iconImage.url, size),
        sizes: String(size) + 'x' + size,
        type: 'image/png',
        purpose: 'any' as const,
      }))
    : fallbackIcons;

  const manifest: MetadataRoute.Manifest = {
    id: startUrl,
    name: data.business.name,
    short_name: data.business.name.slice(0, 24),
    description: data.about?.slice(0, 160) || 'אתר העסק, נוח לשימוש גם מהנייד.',
    lang: 'he',
    dir: 'rtl',
    start_url: startUrl,
    scope: startUrl,
    display: 'standalone',
    background_color: data.branding?.colors?.background || '#ffffff',
    theme_color: data.branding?.colors?.primary || '#17324d',
    icons,
  };

  return Response.json(manifest, {
    headers: { 'Cache-Control': 'public, max-age=60, s-maxage=60' },
  });
}
