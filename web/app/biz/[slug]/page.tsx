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

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const resolvedParams = await params;
  const ctx = await getCtx(resolvedParams.slug);
  let data = null;
  try { data = await getStorefront(ctx); } catch { /* backend down: fall through */ }
  if (!data) return { title: 'העסק לא נמצא', robots: { index: false } };

  const { og, business } = data;
  const description = og?.description ?? undefined;
  const images = og?.image_url ? [{ url: og.image_url, alt: og?.title || '' }] : undefined;

  let metadataBase: URL | undefined = undefined;
  try {
    if (ctx.origin) metadataBase = new URL(ctx.origin);
  } catch {
    /* fallback if ctx.origin is not a valid absolute URL */
  }

  return {
    metadataBase,
    title: og?.title || business?.name || 'עסק',
    description,
    alternates: { canonical: ctx.base || '/' },
    openGraph: {
      type: 'website', locale: 'he_IL', siteName: business?.name,
      title: og?.title || business?.name, description, url: ctx.base || '/', images,
    },
    twitter: {
      card: images ? 'summary_large_image' : 'summary',
      title: og?.title || business?.name, description, images: images?.map((i) => i.url),
    },
  };
}

export default async function StorefrontPage({ params }: Props) {
  const resolvedParams = await params;
  const ctx = await getCtx(resolvedParams.slug);
  const data = await getStorefront(ctx);
  if (!data) notFound();

  const { business: b, opening_hours: oh } = data;
  const chip = 'rounded-full border border-ink/20 px-3 py-1.5 text-sm hover:bg-primary/5';

  return (
    <div className="brand-root min-h-screen bg-surface text-ink" style={themeVars(data.branding?.colors)}>
      {oh?.show_out_of_hours_banner && (
        <div role="status" className="bg-amber-100 px-4 py-2 text-center text-sm font-medium text-amber-900">
          {oh.banner_message ?? 'אנחנו סגורים כרגע. השאירו פנייה ונחזור אליכם בשעות הפעילות.'}
        </div>
      )}

      {data.sections?.gallery && data.gallery && <Gallery images={data.gallery} />}

      <main className="mx-auto max-w-3xl space-y-7 px-4 py-5 sm:space-y-8 sm:py-8">
        <header className="rounded-2xl border border-ink/10 bg-white/70 p-4 sm:p-6">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{b?.name}</h1>
          <div className="mt-3 flex flex-wrap gap-2">
            {b?.phone && (
              <a className={chip} href={`tel:${toLocalPhone(b.phone)}`}>
                התקשרו: <span dir="ltr">{toLocalPhone(b.phone)}</span>
              </a>
            )}
            {b?.whatsapp_number && (
              <a
                className={`${chip} border-transparent bg-primary text-primary-fg hover:opacity-90`}
                href={`https://wa.me/${b.whatsapp_number.replace(/^\+/, '')}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                וואטסאפ
              </a>
            )}
            {b?.email && <a className={chip} href={`mailto:${b.email}`}>{b.email}</a>}
          </div>
        </header>

        {data.sections?.about && data.about && (
          <section aria-labelledby="about-h" className="rounded-2xl border border-ink/10 bg-white p-4 sm:p-6">
            <h2 id="about-h" className="text-xl font-bold sm:text-2xl">הסיפור שלנו</h2>
            <p className="mt-3 whitespace-pre-line leading-relaxed text-ink/80">{data.about}</p>
          </section>
        )}

        {data.catalog && (
          <OrderSection
            apiBase={ctx.path}
            items={data.catalog.items || []}
            quoteLabel={data.catalog.quote_label}
            flow={data.order_flow}
          />
        )}

        {oh?.days && <Hours days={oh.days} openNow={oh.open_now} />}

        <footer className="border-t border-ink/15 px-4 py-5 text-center text-sm text-ink/70">
          <nav className="flex flex-wrap justify-center gap-x-5 gap-y-2" aria-label="מידע משפטי">
            <a href={`${ctx.base}/legal/terms_of_use`}>תנאי שימוש</a>
            <a href={`${ctx.base}/legal/privacy_policy`}>מדיניות פרטיות</a>
            <a href={`${ctx.base}/legal/accessibility_statement`}>הצהרת נגישות</a>
          </nav>
        </footer>
      </main>

      <AccessibilityToolbar statementHref={`${ctx.base}/legal/accessibility_statement`} />
    </div>
  );
}
