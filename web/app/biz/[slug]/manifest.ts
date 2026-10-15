import type { MetadataRoute } from 'next';
import { notFound } from 'next/navigation';
import { getCtx, getStorefront } from '@/lib/api';

export const revalidate = 60;

export default async function manifest({ params }: { params: Promise<{ slug: string }> }): Promise<MetadataRoute.Manifest> {
  const { slug } = await params;
  const ctx = await getCtx(slug);
  const data = await getStorefront(ctx);
  if (!data) notFound();

  const startUrl = ctx.base || '/';
  const scope = ctx.base || '/';
  const iconImage = data.gallery.find((image) => image.id === data.branding?.icon_gallery_image_id)
    ?? data.gallery.find((image) => image.id === data.branding?.hero_gallery_image_id)
    ?? data.gallery[0];
  const iconUrl = iconImage?.url ?? data.og?.image_url ?? undefined;
  return {
    id: startUrl,
    name: data.business.name,
    short_name: data.business.name.slice(0, 24),
    description: data.about?.slice(0, 160) || 'אתר העסק, נוח לשימוש גם מהנייד.',
    lang: 'he',
    dir: 'rtl',
    start_url: startUrl,
    scope,
    display: 'standalone',
    background_color: data.branding?.colors?.background || '#ffffff',
    theme_color: data.branding?.colors?.primary || '#17324d',
    icons: iconUrl ? [{ src: iconUrl, purpose: 'any' }] : [],
  };
}
