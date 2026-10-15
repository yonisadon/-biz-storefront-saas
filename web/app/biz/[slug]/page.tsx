import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import AccessibilityToolbar from '@/components/AccessibilityToolbar';
import StorefrontGallery from '@/components/StorefrontGallery';
import Hours from '@/components/Hours';
import OrderSection from '@/components/OrderSection';
import { getCtx, getStorefront } from '@/lib/api';
import { toLocalPhone } from '@/lib/format';
import { themeVars } from '@/lib/theme';

export const revalidate = 30;
type Props = { params: Promise<{ slug: string }> };

function safeSocialHref(value: string | undefined, network: 'instagram' | 'facebook'): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return undefined;
    const host = url.hostname.toLowerCase();
    const allowed = network === 'instagram'
      ? ['instagram.com', 'www.instagram.com']
      : ['facebook.com', 'www.facebook.com', 'm.facebook.com', 'fb.com', 'www.fb.com'];
    return allowed.includes(host) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const resolvedParams = await params;
  const ctx = await getCtx(resolvedParams.slug);
  let data = null;
  try { data = await getStorefront(ctx); } catch { /* backend down: fall through */ }
  if (!data) return { title: 'העסק לא נמצא', robots: { index: false } };
  const { og, business } = data;
  const description = og?.description ?? undefined;
  const images = og?.image_url ? [{ url: og.image_url, alt: og?.title || '' }] : undefined;
  let metadataBase: URL | undefined;
  try { if (ctx.origin) metadataBase = new URL(ctx.origin); } catch { /* invalid origin */ }
  return {
    metadataBase, title: og?.title || business?.name || 'עסק', description,
    icons: images ? { icon: images[0].url, apple: images[0].url } : undefined,
    alternates: { canonical: ctx.base || '/' },
    openGraph: { type: 'website', locale: 'he_IL', siteName: business?.name, title: og?.title || business?.name, description, url: ctx.base || '/', images },
    twitter: { card: images ? 'summary_large_image' : 'summary', title: og?.title || business?.name, description, images: images?.map(i => i.url) },
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
  const whatsappHref = b?.whatsapp_number ? `https://wa.me/${b.whatsapp_number.replace(/\D/g, '').replace(/^0/, '972')}` : undefined;
  const phoneHref = b?.phone ? `tel:${toLocalPhone(b.phone)}` : undefined;

  return <div className="brand-root min-h-screen overflow-x-clip bg-surface text-ink" style={themeVars(data.branding?.colors)}>
    {oh?.show_out_of_hours_banner && <div role="status" className="border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-center text-sm font-medium text-amber-950">{oh.banner_message ?? 'אנחנו סגורים כרגע. השאירו פנייה ונחזור אליכם בשעות הפעילות.'}</div>}
    <main className="mx-auto max-w-6xl px-3 pb-10 pt-3 sm:px-6 sm:pt-6">
      {data.gallery?.length > 0 && <div className="mb-7 sm:mb-9"><StorefrontGallery images={data.gallery} heroId={data.branding?.hero_gallery_image_id} /></div>}
      <header className="mx-auto mb-8 max-w-4xl px-2 py-3 text-center sm:mb-10 sm:py-5">
        <div aria-hidden="true" className="mx-auto mb-4 h-1 w-16 rounded-full" style={{ background: 'var(--brand-accent)' }} />
        <h1 className="text-3xl font-black leading-tight tracking-tight text-ink sm:text-5xl lg:text-6xl">{b?.name}</h1>
        {data.about?.trim() && <p className="mx-auto mt-4 max-w-2xl whitespace-pre-line text-base leading-7 text-ink/75 sm:text-lg sm:leading-8">{data.about.trim()}</p>}
      </header>
      {data.catalog?.items?.length ? <section className="mt-5 rounded-[1.75rem] border border-ink/10 bg-white p-4 shadow-sm sm:mt-7 sm:p-6 lg:p-8"><OrderSection apiBase={ctx.path} items={data.catalog.items} quoteLabel={data.catalog.quote_label} flow={data.order_flow} openingHours={oh?.days ?? null} /></section> : null}
      {hasBusinessInfo && <section aria-labelledby="business-info-h" className="mt-5 rounded-[1.75rem] border border-ink/10 bg-white p-4 shadow-sm sm:mt-7 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 id="business-info-h" className="text-xl font-extrabold tracking-tight sm:text-2xl">פרטי העסק</h2>
          {oh?.open_now === true && <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-800"><span aria-hidden="true" className="h-2 w-2 rounded-full bg-emerald-500" /> פתוח עכשיו</span>}
          {oh?.open_now === false && <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700"><span aria-hidden="true" className="h-2 w-2 rounded-full bg-slate-400" /> סגור עכשיו</span>}
        </div>
        <div className={oh?.days && hasContact ? 'grid gap-6 sm:grid-cols-2 sm:gap-8' : ''}>
          {oh?.days && <div className={hasContact ? 'border-b border-ink/10 pb-5 sm:border-b-0 sm:border-e sm:pb-0 sm:pe-7' : ''}><Hours days={oh.days} openNow={oh.open_now} embedded={true} /></div>}
          {publicAddress && <div className={hasContact ? 'mb-6 border-b border-ink/10 pb-5 sm:mb-0 sm:border-b-0 sm:border-e sm:pb-0 sm:pe-7' : ''}>
            <h3 className="mb-2 text-base font-bold">כתובת העסק</h3>
            <p className="text-sm leading-6 text-ink/75">{publicAddress}</p>
            {addressHref && <a href={addressHref} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex min-h-9 items-center gap-2 text-sm font-semibold text-primary underline-offset-4 hover:underline"><span aria-hidden="true">↗</span> ניווט למקום</a>}
          </div>}
          {hasContact && <div className="min-w-0"><h3 className="mb-3 text-base font-bold">יצירת קשר</h3>
            <div className="flex flex-wrap items-center gap-3">
              {whatsappHref && <a href={whatsappHref} target="_blank" rel="noopener noreferrer" aria-label="פתיחת WhatsApp" title="WhatsApp" className="flex h-12 w-12 items-center justify-center rounded-full bg-[#25D366] text-white shadow-sm transition hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"><svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor" aria-hidden="true"><path d="M20.52 3.48A11.8 11.8 0 0 0 12.12 0C5.58 0 .25 5.33.25 11.87c0 2.1.55 4.15 1.6 5.96L.15 24l6.32-1.66a11.9 11.9 0 0 0 5.65 1.44h.01c6.54 0 11.87-5.33 11.87-11.87 0-3.17-1.23-6.15-3.48-8.43ZM12.13 21.76a9.9 9.9 0 0 1-5.05-1.38l-.36-.21-3.75.98 1-3.65-.24-.38a9.84 9.84 0 0 1-1.51-5.25c0-5.46 4.45-9.91 9.92-9.91 2.65 0 5.14 1.03 7.01 2.9a9.86 9.86 0 0 1 2.9 7.01c0 5.47-4.45 9.89-9.92 9.89Zm5.44-7.42c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.95 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.47-.89-.79-1.49-1.77-1.67-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.18.2-.3.3-.5.1-.2.05-.37-.03-.52-.08-.15-.67-1.62-.92-2.22-.24-.58-.48-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.49s1.07 2.89 1.22 3.09c.15.2 2.1 3.2 5.08 4.49.71.31 1.27.5 1.7.64.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2.01-1.42.25-.7.25-1.3.17-1.42-.07-.13-.27-.2-.57-.35Z"/></svg></a>}
              {instagramHref && <a href={instagramHref} target="_blank" rel="noopener noreferrer" aria-label="פתיחת Instagram" title="Instagram" className="flex h-12 w-12 items-center justify-center rounded-full border border-ink/15 bg-white text-ink shadow-sm transition hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"><svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg></a>}
              {facebookHref && <a href={facebookHref} target="_blank" rel="noopener noreferrer" aria-label="פתיחת Facebook" title="Facebook" className="flex h-12 w-12 items-center justify-center rounded-full border border-ink/15 bg-white text-[#1877F2] shadow-sm transition hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"><svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor" aria-hidden="true"><path d="M13.4 21v-8h2.7l.4-3.1h-3.1V8c0-.9.3-1.5 1.6-1.5h1.7V3.7c-.3 0-1.4-.1-2.6-.1-2.6 0-4.3 1.6-4.3 4.5v1.8H7V13h2.8v8h3.6Z"/></svg></a>}
              {b?.phone && <a href={phoneHref} aria-label={`חיוג ל-${toLocalPhone(b.phone)}`} title="טלפון" className="flex h-12 w-12 items-center justify-center rounded-full border border-ink/15 bg-white text-ink shadow-sm transition hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"><span aria-hidden="true" className="text-xl">☎</span></a>}
              {b?.email && <a href={`mailto:${b.email}`} aria-label={`שליחת דוא"ל ל-${b.email}`} title="דוא״ל" className="flex h-12 w-12 items-center justify-center rounded-full border border-ink/15 bg-white text-ink shadow-sm transition hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"><span aria-hidden="true" className="text-xl">✉</span></a>}
            </div>
          </div>}
        </div>
      </section>}
      <footer className="mt-8 border-t border-ink/10 px-2 py-6 text-center text-sm text-ink/65"><nav className="flex flex-wrap justify-center gap-x-5 gap-y-2" aria-label="מידע משפטי"><a className="transition hover:text-primary" href={`${ctx.base}/legal/terms_of_use`}>תנאי שימוש</a><a className="transition hover:text-primary" href={`${ctx.base}/legal/privacy_policy`}>מדיניות פרטיות</a><a className="transition hover:text-primary" href={`${ctx.base}/legal/accessibility_statement`}>הצהרת נגישות</a></nav></footer>
    </main>
    <AccessibilityToolbar statementHref={`${ctx.base}/legal/accessibility_statement`} />
  </div>;
}
