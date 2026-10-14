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

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-5 sm:space-y-8 sm:px-6 sm:py-8">
        <header className="relative isolate overflow-hidden rounded-3xl border border-ink/10 bg-white p-5 shadow-sm sm:p-8 lg:p-10">
          <div aria-hidden="true" className="pointer-events-none absolute -left-12 -top-16 -z-10 h-48 w-48 rounded-full bg-primary/10 blur-2xl sm:h-64 sm:w-64" />
          <div className="max-w-3xl">
            <p className="mb-3 inline-flex items-center gap-2 rounded-full bg-secondary/40 px-3 py-1.5 text-sm font-semibold text-ink">
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-accent" />
              העסק שלכם, השירות שלנו
            </p>
            <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-ink sm:text-4xl lg:text-5xl">{b?.name}</h1>
            <p className="mt-3 max-w-2xl text-base leading-7 text-ink/70 sm:text-lg">
              מוזמנים להכיר את השירותים שלנו וליצור איתנו קשר. נשמח לעזור.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              {b?.whatsapp_number && (
                <a
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#168A52] px-6 py-3 font-bold text-white shadow-sm transition hover:bg-[#117443] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#168A52]"
                  href={`https://wa.me/${b.whatsapp_number.replace(/^\+/, '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-current">
                    <path d="M20.52 3.48A11.83 11.83 0 0 0 12.1 0C5.55 0 .22 5.33.22 11.88c0 2.1.55 4.16 1.6 5.98L.12 24l6.3-1.65a11.9 11.9 0 0 0 5.68 1.45h.01c6.55 0 11.88-5.33 11.88-11.88 0-3.17-1.23-6.15-3.47-8.44ZM12.1 21.78h-.01a9.88 9.88 0 0 1-5.03-1.37l-.36-.21-3.74.98 1-3.65-.24-.37a9.84 9.84 0 0 1-1.51-5.28c0-5.46 4.44-9.9 9.9-9.9 2.65 0 5.14 1.03 7.01 2.9a9.85 9.85 0 0 1 2.9 7.01c0 5.46-4.44 9.89-9.92 9.89Zm5.43-7.41c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.27-.47-2.42-1.5-.9-.8-1.51-1.79-1.69-2.09-.17-.3-.02-.46.13-.61.14-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.08-.8.37-.27.3-1.04 1.02-1.04 2.49s1.07 2.89 1.22 3.09c.15.2 2.1 3.2 5.08 4.49.71.3 1.27.49 1.7.63.72.23 1.37.2 1.88.12.57-.08 1.76-.72 2.01-1.42.25-.7.25-1.3.17-1.42-.07-.13-.27-.2-.57-.35Z" />
                  </svg>
                  דברו איתנו בוואטסאפ
                </a>
              )}
              {b?.phone && (
                <a className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-ink/20 bg-white px-6 py-3 font-semibold text-ink transition hover:bg-primary/5"
                  href={`tel:${toLocalPhone(b.phone)}`}>
                  <span aria-hidden="true">☎</span>
                  התקשרו אלינו <span dir="ltr">{toLocalPhone(b.phone)}</span>
                </a>
              )}
              {b?.email && (
                <a className="inline-flex min-h-12 items-center justify-center rounded-full border border-ink/20 bg-white px-6 py-3 font-semibold text-ink transition hover:bg-primary/5"
                  href={`mailto:${b.email}`}>שלחו לנו דוא״ל</a>
              )}
            </div>
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
