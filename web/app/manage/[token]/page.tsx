import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import Dashboard from '@/components/manage/Dashboard';
import type { LeadsResponse, ManageBusiness } from '@/lib/types';

export const dynamic = 'force-dynamic';

const TOKEN_RE = /^[A-Za-z0-9_-]{43,128}$/;

function pwaIconUrl(url: string, size: number): string {
  return url.replace(/\.jpg(?:\?.*)?$/, '.icon-' + size + '.png');
}

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  if (!TOKEN_RE.test(token)) return { title: 'ניהול העסק', robots: { index: false, follow: false } };

  let businessName = 'העסק';
  let appIcon: string | undefined;
  const baseUrl = `${process.env.API_URL}/api/manage/${token}`;

  // Fetch business metadata independently: a gallery error must not discard a valid business name.
  try {
    const businessResponse = await fetch(`${baseUrl}/business`, { cache: 'no-store' });
    if (businessResponse.ok) {
      const biz = await businessResponse.json() as ManageBusiness;
      businessName = biz.name || businessName;
      try {
        const galleryResponse = await fetch(`${baseUrl}/gallery`, { cache: 'no-store' });
        if (galleryResponse.ok) {
          const gallery = await galleryResponse.json() as { id: string; url: string }[];
          const branding = biz.config?.branding;
          appIcon = gallery.find((image) => image.id === branding?.icon_gallery_image_id)?.url
            ?? gallery.find((image) => image.id === branding?.hero_gallery_image_id)?.url
            ?? gallery[0]?.url;
        }
      } catch { /* Keep business-specific text if image lookup fails. */ }
    }
  } catch { /* Keep safe generic metadata if the API is temporarily unavailable. */ }

  const title = `ניהול ${businessName}`;
  const description = `אזור הניהול הפרטי של ${businessName}`;
  const icon192 = appIcon ? pwaIconUrl(appIcon, 192) : undefined;
  const socialImage = appIcon?.replace(/\.jpg(?:\?.*)?$/, '.og.jpg');
  const socialImages = socialImage ? [{ url: socialImage, alt: `ניהול ${businessName}` }] : undefined;

  return {
    title,
    description,
    applicationName: title,
    manifest: `/manage/${token}/manifest.webmanifest`,
    icons: icon192 ? {
      icon: [{ url: icon192, sizes: '192x192', type: 'image/png' }],
      apple: [{ url: icon192, sizes: '192x192', type: 'image/png' }],
    } : undefined,
    openGraph: {
      type: 'website',
      locale: 'he_IL',
      title,
      description,
      siteName: title,
      images: socialImages,
    },
    twitter: {
      card: socialImages ? 'summary_large_image' : 'summary',
      title,
      description,
      images: socialImages,
    },
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
  };
}

export default async function ManagePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!TOKEN_RE.test(token)) notFound();

  const xff = (await headers()).get('x-forwarded-for');
  const get = async <T,>(sub: string): Promise<T | null> => {
    const res = await fetch(`${process.env.API_URL}/api/manage/${token}/${sub}`, {
      cache: 'no-store',
      headers: xff ? { 'x-forwarded-for': xff } : {},
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`backend ${res.status}`);
    return res.json() as Promise<T>;
  };

  const [biz, leads] = await Promise.all([
    get<ManageBusiness>('business'),
    get<LeadsResponse>('leads?limit=25'),
  ]);
  if (!biz || !leads) notFound(); // invalid, expired or revoked token: same page as any 404

  return <Dashboard token={token} initialBusiness={biz} initialLeads={leads} />;
}
