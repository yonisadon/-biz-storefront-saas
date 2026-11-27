'use client';

import { usePlatformLanguage } from '@/components/PlatformLanguageProvider';

type Theme = 'soft' | 'flat' | 'editorial' | 'creative';
type Layout = 'cards' | 'list' | 'carousel' | 'luxury_catalog';
type GalleryLayout = 'slider' | 'thumbnails';

const themes: { id: Theme; title: import('@/lib/platformI18n').PlatformMessageKey; description: import('@/lib/platformI18n').PlatformMessageKey }[] = [
  { id: 'soft', title: 'themeSoftTitle', description: 'themeSoftDescription' },
  { id: 'flat', title: 'themeFlatTitle', description: 'themeFlatDescription' },
  { id: 'editorial', title: 'themeEditorialTitle', description: 'themeEditorialDescription' },
  { id: 'creative', title: 'themeCreativeTitle', description: 'themeCreativeDescription' },
];
const layouts: { id: Layout; title: import('@/lib/platformI18n').PlatformMessageKey; description: import('@/lib/platformI18n').PlatformMessageKey }[] = [
  { id: 'cards', title: 'layoutCardsTitle', description: 'layoutCardsDescription' },
  { id: 'list', title: 'layoutListTitle', description: 'layoutListDescription' },
  { id: 'carousel', title: 'layoutCarouselTitle', description: 'layoutCarouselDescription' },
  { id: 'luxury_catalog', title: 'layoutLuxuryTitle', description: 'layoutLuxuryDescription' },
];
const galleryLayouts: { id: GalleryLayout; title: import('@/lib/platformI18n').PlatformMessageKey; description: import('@/lib/platformI18n').PlatformMessageKey }[] = [
  { id: 'slider', title: 'gallerySliderTitle', description: 'gallerySliderDescription' },
  { id: 'thumbnails', title: 'galleryThumbnailsTitle', description: 'galleryThumbnailsDescription' },
];

function LayoutPreview({ theme }: { theme: Theme }) {
  return <div aria-hidden="true" className={`theme-picker-preview theme-preview-${theme}`}>
    <div className="theme-preview-photo" />
    <div className="theme-preview-copy"><span /><span /><i /></div>
    <div className="theme-preview-items"><i /><i /><i /></div>
  </div>;
}

export default function StorefrontDesignPicker({
  theme, onThemeChange, productLayout, onProductLayoutChange, serviceLayout, onServiceLayoutChange,
  galleryLayout, onGalleryLayoutChange,
}: {
  theme: Theme; onThemeChange: (value: Theme) => void;
  productLayout: Layout; onProductLayoutChange: (value: Layout) => void;
  serviceLayout: Layout; onServiceLayoutChange: (value: Layout) => void;
  galleryLayout: GalleryLayout; onGalleryLayoutChange: (value: GalleryLayout) => void;
}) {
  const { t } = usePlatformLanguage();
  const layoutPicker = (id: 'products' | 'services', value: Layout, onChange: (value: Layout) => void) => (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold">{t(id === 'products' ? 'productsLayoutTitle' : 'servicesLayoutTitle')}</legend>
      <p className="text-xs leading-5 text-slate-500">{t('itemLayoutIntro')}</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {layouts.map((option) => <label key={option.id} className={`flex min-h-20 cursor-pointer flex-col justify-center rounded-xl border p-3 text-start transition ${value === option.id ? 'border-slate-900 bg-slate-50 ring-2 ring-slate-900/10' : 'border-slate-200 hover:border-slate-400'}`}>
          <span className="flex items-center gap-2 text-sm font-semibold"><input type="radio" name={id + '-layout'} value={option.id} checked={value === option.id} onChange={() => onChange(option.id)} />{t(option.title)}</span>
          <span className="mt-1 text-xs leading-5 text-slate-500">{t(option.description)}</span>
        </label>)}
      </div>
    </fieldset>
  );
  return <section className="space-y-5" aria-labelledby="storefront-design-title">
    <div><h3 id="storefront-design-title" className="text-base font-bold">{t('designThemeTitle')}</h3><p className="mt-1 text-xs leading-5 text-slate-500">{t('designThemeIntro')}</p></div>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {themes.map((option) => <label key={option.id} className={`cursor-pointer rounded-2xl border p-3 transition ${theme === option.id ? 'border-slate-900 bg-slate-50 ring-2 ring-slate-900/10' : 'border-slate-200 hover:border-slate-400'}`}>
        <span className="flex items-center gap-2 text-sm font-bold"><input type="radio" name="storefront-theme" value={option.id} checked={theme === option.id} onChange={() => onThemeChange(option.id)} />{t(option.title)}</span>
        <LayoutPreview theme={option.id} />
        <span className="mt-2 block text-xs leading-5 text-slate-500">{t(option.description)}</span>
      </label>)}
    </div>
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold">{t('galleryLayoutTitle')}</legend>
      <p className="text-xs leading-5 text-slate-500">{t('galleryLayoutIntro')}</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {galleryLayouts.map((option) => <label key={option.id} className={`flex min-h-20 cursor-pointer flex-col justify-center rounded-xl border p-3 text-start transition ${galleryLayout === option.id ? 'border-slate-900 bg-slate-50 ring-2 ring-slate-900/10' : 'border-slate-200 hover:border-slate-400'}`}>
          <span className="flex items-center gap-2 text-sm font-semibold"><input type="radio" name="hero-gallery-layout" value={option.id} checked={galleryLayout === option.id} onChange={() => onGalleryLayoutChange(option.id)} />{t(option.title)}</span>
          <span className="mt-1 text-xs leading-5 text-slate-500">{t(option.description)}</span>
        </label>)}
      </div>
    </fieldset>
    <div className="grid gap-5 sm:grid-cols-2">
      {layoutPicker('products', productLayout, onProductLayoutChange)}
      {layoutPicker('services', serviceLayout, onServiceLayoutChange)}
    </div>
  </section>;
}
