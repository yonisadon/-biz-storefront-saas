import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import AccessibilityToolbar from '@/components/AccessibilityToolbar';
import Gallery from '@/components/Gallery';
import Hours from '@/components/Hours';
import OrderSection from '@/components/OrderSection';
import { getCtx, getStorefront } from '@/lib/api';
import { toLocalPhone } from '@/lib/format';
import { themeVars } from '@/lib/theme';

export const revalidate = 30;

type Props = { params: Promise<{ slug: string }> };

// Runs on the server, so WhatsApp/Facebook scrapers see these tags in the raw HTML
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const ctx = await getCtx((await params).slug);
  let data = null;
  try { data = await getStorefront(ctx); } catch { /* backend down: fall through */ }
  if (!data) return { title: 'העסק לא נמצא', robots: { index: false } };

  const { og, business } = data;
  const description = og.description ?? undefined;
  const images = og.image_url ? [{ url: og.image_url, alt: og.title }] : undefined;

  return {
    metadataBase: new URL(ctx.origin),
    title: og.title,
    description,
    alternates: { canonical: ctx.base || '/' },
    openGraph: {
      type: 'website', locale: 'he_IL', siteName: business.name,
      title: og.title, description, url: ctx.base || '/', images,
    },
    twitter: {
      card: images ? 'summary_large_image' : 'summary',
      title: og.title, description, images: images?.map((i) => i.url),
    },
  };
}

export default async function StorefrontPage({ params }: Props) {
  const ctx = await getCtx((await params).slug);
  const data = await getStorefront(ctx);
  if (!data) notFound();

  const { business: b, opening_hours: oh } = data;
  const chip = 'rounded-full border border-ink/20 px-3 py-1.5 text-sm hover:bg-ink/5';

  return (
    <div className="brand-root min-h-screen bg-surface text-ink" style={themeVars(data.branding?.colors)}>
      {oh.show_out_of_hours_banner && (
        <div role="status" className="bg-amber-100 px-4 py-2 text-center text-sm font-medium text-amber-900">
          {oh.banner_message ?? 'אנחנו סגורים כרגע. השאירו פנייה ונחזור אליכם בשעות הפעילות.'}
        </div>
      )}

      {/* Hidden entirely when there are no images */}
      {data.sections.gallery && <Gallery images={data.gallery} />}

      <main className="mx-auto max-w-3xl space-y-10 px-4 py-6">
        <header className="space-y-3">
          <h1 className="text-3xl font-bold">{b.name}</h1>
          <div className="flex flex-wrap gap-2">
            {b.phone && <a className={chip} href={`tel:${toLocalPhone(b.phone)}`}>התקשרו: {toLocalPhone(b.phone)}</a>}
            {b.whatsapp_number && (
              <a className={chip} href={`https://wa.me/${b.whatsapp_number.slice(1)}`} target="_blank" rel="noopener noreferrer">וואטסאפ</a>
            )}
            {b.email && <a className={chip} href={`mailto:${b.email}`}>{b.email}</a>}
          </div>
        </header>

        {/* Shown only if the seller entered text */}
        {data.sections.about && (
          <section aria-labelledby="about-h">
            <h2 id="about-h" className="text-2xl font-bold">הסיפור שלנו</h2>
            <p className="mt-3 whitespace-pre-line leading-relaxed text-ink/80">{data.about}</p>
          </section>
        )}

        <OrderSection
          apiBase={ctx.path}
          items={data.catalog.items}
          quoteLabel={data.catalog.quote_label}
          flow={data.order_flow}
        />

        {oh.days && (
          <section aria-labelledby="hours-h">
            <h2 id="hours-h" className="text-2xl font-bold">שעות פעילות</h2>
            <Hours days={oh.days} />
          </section>
        )}
      </main>

      <footer className="border-t border-ink/15 px-4 py-6 text-center text-sm text-ink/70">
        <nav className="flex flex-wrap justify-center gap-x-5 gap-y-2" aria-label="מידע משפטי">
          <a href={`${ctx.base}/legal/terms_of_use`}>תנאי שימוש</a>
          <a href={`${ctx.base}/legal/privacy_policy`}>מדיניות פרטיות</a>
          <a href={`${ctx.base}/legal/accessibility_statement`}>הצהרת נגישות</a>
        </nav>
      </footer>

      <AccessibilityToolbar statementHref={`${ctx.base}/legal/accessibility_statement`} />
    </div>
  );
}