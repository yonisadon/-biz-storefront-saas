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
  const hasContact = Boolean(b?.phone || b?.email || b?.whatsapp_number);
  const hasBusinessInfo = Boolean(oh?.days || hasContact);

  return (
    <div className="brand-root min-h-screen bg-surface text-ink" style={themeVars(data.branding?.colors)}>
      {oh?.show_out_of_hours_banner && (
        <div role="status" className="bg-amber-100 px-4 py-2 text-center text-sm font-medium text-amber-900">
          {oh.banner_message ?? 'אנחנו סגורים כרגע. השאירו פנייה ונחזור אליכם בשעות הפעילות.'}
        </div>
      )}

      {data.sections?.gallery && data.gallery && <Gallery images={data.gallery} />}

      <main className="mx-auto max-w-3xl space-y-6 px-4 py-5 sm:space-y-7 sm:py-8">
        <header className="py-1">
          <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-ink sm:text-4xl">{b?.name}</h1>
          {data.about?.trim() && (
            <p className="mt-3 whitespace-pre-line text-base leading-7 text-ink/75 sm:text-lg">
              {data.about.trim()}
            </p>
          )}
        </header>

        {data.catalog?.items?.length ? (
          <OrderSection
            apiBase={ctx.path}
            items={data.catalog.items}
            quoteLabel={data.catalog.quote_label}
            flow={data.order_flow}
            openingHours={oh?.days ?? null}
          />
        ) : null}

        {hasBusinessInfo && (
          <section aria-labelledby="business-info-h" className="rounded-2xl border border-ink/10 bg-white p-4 shadow-sm sm:p-5">
            <div className={oh?.days && hasContact ? 'grid gap-4 sm:grid-cols-2 sm:gap-5' : ''}>
              {oh?.days && (
                <div className={hasContact ? 'border-b border-ink/10 pb-3 sm:border-b-0 sm:border-e sm:pb-0 sm:pe-5' : ''}>
                  <Hours days={oh.days} openNow={oh.open_now} embedded />
                </div>
              )}
              {hasContact && (
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2.5">
                    {b?.phone && <a href={`tel:${toLocalPhone(b.phone)}`} aria-label={`חיוג ל-${toLocalPhone(b.phone)}`} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-ink/15 bg-surface px-3 py-2 text-sm font-medium hover:border-primary/50"><svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M5 3h3l2 5-2 1.5a15 15 0 0 0 6.5 6.5L16 14l5 2v3c0 1.1-.9 2-2 2C10 21 3 14 3 5c0-1.1.9-2 2-2Z"/></svg><span dir="ltr">{toLocalPhone(b.phone)}</span></a>}
                    {b?.email && <a href={`mailto:${b.email}`} className="inline-flex min-h-11 min-w-0 items-center gap-2 rounded-xl border border-ink/15 bg-surface px-3 py-2 text-sm font-medium hover:border-primary/50"><svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="5" width="18" height="14" rx="2"/><path strokeLinecap="round" strokeLinejoin="round" d="m4 7 8 6 8-6"/></svg><span className="break-all">{b.email}</span></a>}
                    {b?.whatsapp_number && <a href={`https://wa.me/${b.whatsapp_number.replace(/\D/g, '').replace(/^0/, '972')}`} target="_blank" rel="noopener noreferrer" aria-label="יצירת קשר ב־WhatsApp" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#168A52] px-3 py-2 text-sm font-semibold text-white hover:bg-[#117443]"><svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor"><path d="M20.5 3.5A11.8 11.8 0 0 0 2 17.7L.5 23.5l6-1.6A11.8 11.8 0 0 0 20.5 3.5ZM12 21a9.8 9.8 0 0 1-5-1.4l-.4-.2-3.5.9.9-3.4-.2-.4A9.7 9.7 0 1 1 12 21Zm5.4-7.3c-.3-.2-1.7-.9-2-1s-.5-.2-.7.2-.8 1-1 1.2-.4.2-.7 0a8 8 0 0 1-2.4-1.5 9 9 0 0 1-1.6-2c-.2-.3 0-.5.2-.7l.5-.6.2-.5c.1-.2 0-.4 0-.6l-.9-2.1c-.2-.5-.5-.4-.7-.4h-.6c-.2 0-.6.1-.9.4s-1.1 1.1-1.1 2.6 1.1 3 1.3 3.2a11 11 0 0 0 4.3 3.8c.6.3 1.1.5 1.5.6.6.2 1.2.2 1.7.1.5-.1 1.7-.7 1.9-1.4.2-.7.2-1.3.1-1.4s-.2-.2-.5-.4Z"/></svg><span>WhatsApp</span></a>}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

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
