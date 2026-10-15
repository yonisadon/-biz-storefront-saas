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
  let metadataBase: URL | undefined;
  try { if (ctx.origin) metadataBase = new URL(ctx.origin); } catch { /* invalid origin */ }
  return {
    metadataBase, title: og?.title || business?.name || 'עסק', description,
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
    <main className="mx-auto max-w-6xl px-3 pb-28 pt-3 sm:px-6 sm:pb-12 sm:pt-6">
      <header className="relative isolate overflow-hidden rounded-[2rem] border border-ink/5 px-5 py-8 shadow-sm sm:px-10 sm:py-12 lg:px-14 lg:py-16" style={{ background: 'linear-gradient(135deg, var(--brand-secondary) 0%, var(--brand-background) 78%)' }}>
        <div aria-hidden="true" className="pointer-events-none absolute -end-16 -top-20 h-56 w-56 rounded-full opacity-30 blur-3xl" style={{ background: 'var(--brand-accent)' }} />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-24 -start-12 h-52 w-52 rounded-full opacity-20 blur-3xl" style={{ background: 'var(--brand-primary)' }} />
        <div className="relative max-w-3xl">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-ink/10 bg-white/70 px-3 py-1.5 text-xs font-semibold text-ink/75 shadow-sm backdrop-blur"><span aria-hidden="true" className="h-2 w-2 rounded-full bg-primary" /><span>האתר הרשמי של {b?.name}</span></div>
          <h1 className="max-w-3xl text-3xl font-black leading-tight tracking-tight text-ink sm:text-5xl lg:text-6xl">{b?.name}</h1>
          {data.about?.trim() && <p className="mt-4 max-w-2xl whitespace-pre-line text-base leading-7 text-ink/75 sm:mt-5 sm:text-lg sm:leading-8">{data.about.trim()}</p>}
          {hasContact && <div className="mt-6 flex flex-wrap gap-2.5 sm:mt-8">
            {whatsappHref && <a href={whatsappHref} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-bold text-primary-fg shadow-md transition hover:-translate-y-0.5 hover:shadow-lg"><span aria-hidden="true">✳</span> WhatsApp</a>}
            {phoneHref && <a href={phoneHref} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-ink/15 bg-white/80 px-5 py-3 text-sm font-bold text-ink transition hover:border-primary/50 hover:bg-white"><span aria-hidden="true">☎</span> התקשרו אלינו</a>}
          </div>}
        </div>
      </header>
      {data.sections?.gallery && data.gallery?.length > 0 && <section aria-label="גלריית תמונות" className="mt-5 overflow-hidden rounded-[1.75rem] border border-ink/10 bg-white shadow-sm sm:mt-7"><Gallery images={data.gallery} /></section>}
      {data.catalog?.items?.length ? <section className="mt-5 rounded-[1.75rem] border border-ink/10 bg-white p-4 shadow-sm sm:mt-7 sm:p-6 lg:p-8"><OrderSection apiBase={ctx.path} items={data.catalog.items} quoteLabel={data.catalog.quote_label} flow={data.order_flow} openingHours={oh?.days ?? null} /></section> : null}
      {hasBusinessInfo && <section aria-labelledby="business-info-h" className="mt-5 rounded-[1.75rem] border border-ink/10 bg-white p-4 shadow-sm sm:mt-7 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 id="business-info-h" className="text-xl font-extrabold tracking-tight sm:text-2xl">פרטי העסק</h2>
          {oh?.open_now === true && <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-800"><span aria-hidden="true" className="h-2 w-2 rounded-full bg-emerald-500" /> פתוח עכשיו</span>}
          {oh?.open_now === false && <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700"><span aria-hidden="true" className="h-2 w-2 rounded-full bg-slate-400" /> סגור עכשיו</span>}
        </div>
        <div className={oh?.days && hasContact ? 'grid gap-6 sm:grid-cols-2 sm:gap-8' : ''}>
          {oh?.days && <div className={hasContact ? 'border-b border-ink/10 pb-5 sm:border-b-0 sm:border-e sm:pb-0 sm:pe-7' : ''}><Hours days={oh.days} openNow={oh.open_now} embedded={true} /></div>}
          {hasContact && <div className="min-w-0"><h3 className="mb-3 text-base font-bold">יצירת קשר</h3><div className="flex flex-wrap gap-2.5">
            {b?.phone && <a href={phoneHref} aria-label={`חיוג ל-${toLocalPhone(b.phone)}`} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-ink/15 bg-surface px-3 py-2 text-sm font-semibold transition hover:border-primary/50"><span aria-hidden="true">☎</span><span dir="ltr">{toLocalPhone(b.phone)}</span></a>}
            {b?.email && <a href={`mailto:${b.email}`} className="inline-flex min-h-11 min-w-0 items-center gap-2 rounded-xl border border-ink/15 bg-surface px-3 py-2 text-sm font-semibold transition hover:border-primary/50"><span aria-hidden="true">✉</span><span className="break-all">{b.email}</span></a>}
            {whatsappHref && <a href={whatsappHref} target="_blank" rel="noopener noreferrer" aria-label="יצירת קשר ב־WhatsApp" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-3 py-2 text-sm font-bold text-primary-fg transition hover:opacity-90"><span aria-hidden="true">◉</span><span>WhatsApp</span></a>}
          </div></div>}
        </div>
      </section>}
      <footer className="mt-8 border-t border-ink/10 px-2 py-6 text-center text-sm text-ink/65"><nav className="flex flex-wrap justify-center gap-x-5 gap-y-2" aria-label="מידע משפטי"><a className="transition hover:text-primary" href={`${ctx.base}/legal/terms_of_use`}>תנאי שימוש</a><a className="transition hover:text-primary" href={`${ctx.base}/legal/privacy_policy`}>מדיניות פרטיות</a><a className="transition hover:text-primary" href={`${ctx.base}/legal/accessibility_statement`}>הצהרת נגישות</a></nav></footer>
    </main>
    {hasContact && <div className="fixed inset-x-0 bottom-0 z-40 border-t border-ink/10 bg-white/95 p-3 shadow-[0_-8px_30px_rgba(15,23,42,0.08)] backdrop-blur sm:hidden"><div className="mx-auto flex max-w-lg gap-2">
      {whatsappHref ? <a href={whatsappHref} target="_blank" rel="noopener noreferrer" className="flex min-h-12 flex-1 items-center justify-center rounded-full bg-primary px-4 py-3 text-sm font-bold text-primary-fg">לתיאום ב־WhatsApp</a> : phoneHref ? <a href={phoneHref} className="flex min-h-12 flex-1 items-center justify-center rounded-full bg-primary px-4 py-3 text-sm font-bold text-primary-fg">התקשרו עכשיו</a> : null}
      {phoneHref && whatsappHref && <a href={phoneHref} className="flex min-h-12 items-center justify-center rounded-full border border-ink/15 px-4 py-3 text-sm font-semibold text-ink">חיוג</a>}
    </div></div>}
    <AccessibilityToolbar statementHref={`${ctx.base}/legal/accessibility_statement`} />
  </div>;
}
