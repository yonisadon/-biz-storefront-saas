import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import StorefrontAccessibilityToolbar from '@/components/StorefrontAccessibilityToolbar';
import StorefrontPwaInstallButton from '@/components/StorefrontPwaInstallButton';
import StorefrontContactLinks from '@/components/StorefrontContactLinks';
import StorefrontGallery from '@/components/StorefrontGallery';
import StorefrontPageComposition from '@/components/StorefrontPageComposition';
import StorefrontLanguageProvider, { StorefrontLanguageSwitcher, StorefrontText } from '@/components/StorefrontLanguageProvider';
import Hours from '@/components/Hours';
import OrderSection from '@/components/OrderSection';
import ReadMoreText from '@/components/ReadMoreText';
import { getCtx, getStorefront } from '@/lib/api';
import { themeVars } from '@/lib/theme';
import { normalizeStorefrontLanguage } from '@/lib/storefrontI18n';

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
  const storefrontLanguage = normalizeStorefrontLanguage(business?.locale);
  const openGraphLocale = storefrontLanguage === 'en' ? 'en_US' : storefrontLanguage === 'ru' ? 'ru_RU' : 'he_IL';
  const description = og?.description ?? undefined;
  const images = og?.image_url ? [{ url: og.image_url, alt: og?.title || '' }] : undefined;
  const appIcon = data.gallery.find((image) => image.id === data.branding?.icon_gallery_image_id)?.url
    ?? data.gallery.find((image) => image.id === data.branding?.hero_gallery_image_id)?.url
    ?? data.gallery[0]?.url
    ?? og?.image_url
    ?? undefined;
  let metadataBase: URL | undefined;
  try { if (ctx.origin) metadataBase = new URL(ctx.origin); } catch { /* invalid origin */ }
  return {
    metadataBase, title: og?.title || business?.name || (storefrontLanguage === 'en' ? 'Business' : storefrontLanguage === 'ru' ? 'Компания' : 'עסק'), description,
    manifest: ctx.base ? `${ctx.base}/manifest.webmanifest` : '/biz/_site/manifest.webmanifest',
    icons: appIcon ? { icon: appIcon, apple: appIcon } : undefined,
    alternates: { canonical: ctx.base || '/' },
    openGraph: { type: 'website', locale: openGraphLocale, siteName: business?.name, title: og?.title || business?.name, description, url: ctx.base || '/', images },
    twitter: { card: images ? 'summary_large_image' : 'summary', title: og?.title || business?.name, description, images: images?.map(i => i.url) },
  };
}

export default async function StorefrontPage({ params }: Props) {
  const resolvedParams = await params;
  const ctx = await getCtx(resolvedParams.slug);
  // Legal documents are loaded by their dedicated routes, not this storefront.
  // Avoid making the customer page depend on three unused API requests during SSR.
  const data = await getStorefront(ctx);
  if (!data) notFound();
  const { business: b, opening_hours: oh } = data;
  const social = data.social_links ?? {};
  const profile = data.business_profile ?? {};
  const announcement = data.business_announcement;
  const publicAddress = profile.show_address ? [profile.city, profile.street_address].filter(Boolean).join(', ') : '';
  // Legacy tenants may still have the retired grid setting saved; render them with safe classic cards.
  const productLayout = ['grid', 'gallery'].includes(data.branding?.product_layout ?? '') ? 'cards' : data.branding?.product_layout ?? 'cards';
  const serviceLayout = ['grid', 'gallery'].includes(data.branding?.service_layout ?? '') ? 'cards' : data.branding?.service_layout ?? 'cards';
  const waNumber = (data.contact_options.products.whatsapp_enabled || data.contact_options.services.whatsapp_enabled) && b?.whatsapp_number
    ? b.whatsapp_number.replace(/\D/g, '').replace(/^0/, '972')
    : '';
  const hasContact = Boolean(b?.phone || b?.email || b?.whatsapp_number || social.instagram || social.facebook);
  const hasBusinessInfo = Boolean(oh?.days || hasContact || publicAddress);
  const instagramHref = safeSocialHref(social.instagram, 'instagram');
  const facebookHref = safeSocialHref(social.facebook, 'facebook');
  const addressHref = publicAddress ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(publicAddress)}` : undefined;


  const identitySlot = (
          <header className="storefront-hero mx-auto mb-0 max-w-4xl px-4 py-4 text-center sm:px-10 sm:py-6">
            <div aria-hidden="true" className="mx-auto mb-3 h-1 w-14 rounded-full" style={{ background: 'var(--brand-accent)' }} />
            <h1 className="business-title text-3xl font-bold leading-tight tracking-tight sm:text-5xl lg:text-6xl">{b?.name}</h1>
            {data.about?.trim() && <ReadMoreText text={data.about.trim()} moreLabel={<StorefrontText message="readMore" />} lessLabel={<StorefrontText message="readLess" />} className="storefront-description mx-auto mt-3 max-w-2xl text-base font-medium leading-7 text-ink/80 sm:mt-4 sm:text-lg sm:leading-8" />}
            {hasBusinessInfo && <div className="storefront-hero-actions mt-4"><a href="#contact-section" className="storefront-hero-action text-sm font-semibold text-black underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"><StorefrontText message="contact" /></a></div>}
          </header>
    
  );
  const gallerySlot = (
    <>
          {data.gallery?.length > 0 && <div className="storefront-gallery-wrap mb-6 sm:mb-8">
            <StorefrontGallery images={data.gallery} heroId={data.branding?.hero_gallery_image_id} layout={data.branding?.hero_gallery_layout ?? 'slider'} />
          </div>}
    </>
  );
  const servicesSlot = (
    <>
      {data.catalog.services.total > 0 && <section id="services-section" className="mt-3 scroll-mt-24 rounded-[1.75rem] border border-ink/10 bg-white p-4 shadow-sm sm:mt-5 sm:p-6 lg:p-8">
        <OrderSection apiBase={ctx.path} items={data.catalog.services.items} quoteLabel={data.catalog.quote_label} contactOptions={data.contact_options} kind="service" businessTimezone={b?.timezone ?? "Asia/Jerusalem"} openingHours={oh?.days ?? null} catalogTotal={data.catalog.services.total} hasMore={data.catalog.services.has_more} productLayout={productLayout} serviceLayout={serviceLayout} />
      </section>}
    </>
  );
  const catalogSlot = (
    <>
      {data.catalog.products.total > 0 && <section id="catalog-section" className="mt-3 scroll-mt-24 rounded-[1.75rem] border border-ink/10 bg-white p-4 shadow-sm sm:mt-5 sm:p-6 lg:p-8">
        <OrderSection apiBase={ctx.path} items={data.catalog.products.items} quoteLabel={data.catalog.quote_label} contactOptions={data.contact_options} kind="product" businessTimezone={b?.timezone ?? "Asia/Jerusalem"} openingHours={oh?.days ?? null} catalogTotal={data.catalog.products.total} hasMore={data.catalog.products.has_more} productLayout={productLayout} serviceLayout={serviceLayout} />
      </section>}
    </>
  );
  const contactSlot = (
    <>
          {hasBusinessInfo && <section id="contact-section" aria-labelledby="business-info-h" className="mt-5 scroll-mt-5 rounded-[1.75rem] border border-ink/10 bg-white p-4 shadow-sm sm:mt-7 sm:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 id="business-info-h" className="text-xl font-extrabold tracking-tight sm:text-2xl"><StorefrontText message="businessDetails" /></h2>
              {oh?.open_now === true && <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-800"><span aria-hidden="true" className="h-2 w-2 rounded-full bg-emerald-500" /><StorefrontText message="openNow" /></span>}
              {oh?.open_now === false && <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700"><span aria-hidden="true" className="h-2 w-2 rounded-full bg-slate-400" /><StorefrontText message="closedNow" /></span>}
            </div>
            <div className={oh?.days && hasContact ? 'grid gap-3 sm:grid-cols-2 sm:gap-6' : ''}>
              {oh?.days && <div className={hasContact ? 'border-b border-ink/10 pb-5 sm:border-b-0 sm:border-e sm:pb-0 sm:pe-7' : ''}><Hours days={oh.days} openNow={null} embedded={true} multilingual={true} /></div>}
              {publicAddress && <div className={hasContact ? 'mb-3 border-b border-ink/10 pb-3 sm:mb-0 sm:border-b-0 sm:border-e sm:pb-0 sm:pe-7' : ''}>
                <h3 className="mb-2 text-base font-bold"><StorefrontText message="businessAddress" /></h3>
                <p className="text-sm leading-6 text-ink/75">{publicAddress}</p>
                {addressHref && <a href={addressHref} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex min-h-9 items-center gap-2 text-sm font-semibold text-primary underline-offset-4 hover:underline"><span aria-hidden="true">↗</span><StorefrontText message="directions" /></a>}
              </div>}
              {hasContact && <div className="min-w-0"><h3 className="mb-2 text-base font-bold"><StorefrontText message="contactMethods" /></h3>
                <StorefrontContactLinks whatsappNumber={waNumber} instagramHref={instagramHref} facebookHref={facebookHref} phone={b?.phone ?? undefined} email={b?.email ?? undefined} />
              </div>}
            </div>
          </section>}
    
    </>
  );
  const footerSlot = (
          <footer className="mt-8 border-t border-ink/10 px-2 py-6 text-center text-sm text-ink/65">
            <a className="inline-flex min-h-11 items-center rounded-full border border-ink/15 bg-white px-4 py-2 font-semibold underline-offset-4 transition hover:border-primary/40 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" href={ctx.base ? `${ctx.base}/legal` : '/biz/_site/legal'}><StorefrontText message="legalAndAccessibility" /></a>
          </footer>
    
  );

  return <StorefrontLanguageProvider slug={resolvedParams.slug} businessLocale={b?.locale}><div className="brand-root min-h-screen overflow-x-clip bg-surface text-ink" data-font-style={data.branding?.font_style ?? 'modern'} data-storefront-theme={data.branding?.storefront_theme ?? 'soft'} data-business-title-color={data.branding?.business_title_color === 'black' ? 'black' : 'brand'} data-storefront-profile="default" style={themeVars(data.branding?.colors)}>
    <a href="#storefront-main" className="sr-only z-[100] rounded-md bg-white px-4 py-3 font-bold text-black focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:outline-4 focus:outline-offset-2 focus:outline-black"><StorefrontText message="skipToMainContent" /></a>
    <StorefrontLanguageSwitcher />
    <StorefrontAccessibilityToolbar statementHref={ctx.base ? `${ctx.base}/legal#accessibility_statement` : '/biz/_site/legal#accessibility_statement'} />
    <div className="mx-auto max-w-4xl px-4 pt-3 text-center">
      <StorefrontPwaInstallButton />
    </div>
    {announcement?.enabled && announcement.message.trim() && <aside className="storefront-business-announcement" role="status"><p>{announcement.message.trim()}</p></aside>}
    <StorefrontPageComposition
      hasGallery={data.gallery.length > 0}
      identity={identitySlot}
      gallery={gallerySlot}
      services={servicesSlot}
      catalog={catalogSlot}
      contact={contactSlot}
      footer={footerSlot}
    />
  </div></StorefrontLanguageProvider>;
}
