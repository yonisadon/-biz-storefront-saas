'use client';

type Theme = 'soft' | 'flat' | 'editorial' | 'creative';
type Layout = 'cards' | 'gallery' | 'list' | 'grid' | 'carousel' | 'luxury_catalog';
type GalleryLayout = 'slider' | 'thumbnails';

const themes: { id: Theme; title: string; description: string }[] = [
  { id: 'soft', title: 'Soft · רך ואלגנטי', description: 'כרטיסים מעוגלים, צללים עדינים וריווח נעים.' },
  { id: 'flat', title: 'Flat · נקי ומודרני', description: 'אזורים פתוחים, קווים נקיים ומינימום מסגרות.' },
  { id: 'editorial', title: 'Editorial · יוקרתי ומגזיני', description: 'טיפוגרפיה מודגשת, קווים דקים וקומפוזיציה מאופקת.' },
  { id: 'creative', title: 'Creative · נועז ויצירתי', description: 'קומפוזיציה א-סימטרית, כותרות גדולות ומיקום תמונות משתנה.' },
];
const layouts: { id: Layout; title: string; description: string }[] = [
  { id: 'cards', title: 'כרטיסיות קלאסיות', description: 'העיצוב המוכר: תמונה, שם, תיאור ופעולה בכרטיס ברור.' },
  { id: 'gallery', title: 'גלריית מוצרים', description: 'דגש על התמונות; פרטי המוצר נשארים נגישים ומתחת לתמונה.' },
  { id: 'list', title: 'רשימה', description: 'תמונה לצד פרטי הפריט, בגובה טבעי לפי התוכן.' },
  { id: 'carousel', title: 'קרוסלה', description: 'גלילה אופקית; כל כרטיס בגובה התוכן שלו.' },
  { id: 'luxury_catalog', title: 'קטלוג יוקרתי', description: 'תמונות גדולות ומעט פריטים בכל שורה.' },
];
const galleryLayouts: { id: GalleryLayout; title: string; description: string }[] = [
  { id: 'slider', title: 'גלילה / החלפה אוטומטית', description: 'התצוגה הקיימת: תמונה ראשית ומעבר בין תמונות.' },
  { id: 'thumbnails', title: 'תמונה ראשית ותמונות ממוזערות', description: 'תמונה גדולה ומתחתיה בחירה ישירה של תמונות נוספות.' },
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
  const layoutPicker = (id: string, value: Layout, onChange: (value: Layout) => void) => (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold">{id === 'products' ? 'תצוגת מוצרים' : 'תצוגת שירותים'}</legend>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {layouts.map((option) => <label key={option.id} className={`flex min-h-20 cursor-pointer flex-col justify-center rounded-xl border p-3 text-start transition ${value === option.id ? 'border-slate-900 bg-slate-50 ring-2 ring-slate-900/10' : 'border-slate-200 hover:border-slate-400'}`}>
          <span className="flex items-center gap-2 text-sm font-semibold"><input type="radio" name={id + '-layout'} value={option.id} checked={value === option.id} onChange={() => onChange(option.id)} />{option.title}</span>
          <span className="mt-1 text-xs leading-5 text-slate-500">{option.description}</span>
        </label>)}
      </div>
    </fieldset>
  );
  return <section className="space-y-5" aria-labelledby="storefront-design-title">
    <div><h3 id="storefront-design-title" className="text-base font-bold">סגנון האתר</h3><p className="mt-1 text-xs leading-5 text-slate-500">הסגנון משנה את העיצוב והפריסה בלבד. התוכן, התמונות, המוצרים וההזמנות נשארים ללא שינוי. אפשר להחליף סגנון בכל עת.</p></div>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {themes.map((option) => <label key={option.id} className={`cursor-pointer rounded-2xl border p-3 transition ${theme === option.id ? 'border-slate-900 bg-slate-50 ring-2 ring-slate-900/10' : 'border-slate-200 hover:border-slate-400'}`}>
        <span className="flex items-center gap-2 text-sm font-bold"><input type="radio" name="storefront-theme" value={option.id} checked={theme === option.id} onChange={() => onThemeChange(option.id)} />{option.title}</span>
        <LayoutPreview theme={option.id} />
        <span className="mt-2 block text-xs leading-5 text-slate-500">{option.description}</span>
      </label>)}
    </div>
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold">תצוגת גלריית התמונות הראשית</legend>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {galleryLayouts.map((option) => <label key={option.id} className={`flex min-h-20 cursor-pointer flex-col justify-center rounded-xl border p-3 text-start transition ${galleryLayout === option.id ? 'border-slate-900 bg-slate-50 ring-2 ring-slate-900/10' : 'border-slate-200 hover:border-slate-400'}`}>
          <span className="flex items-center gap-2 text-sm font-semibold"><input type="radio" name="hero-gallery-layout" value={option.id} checked={galleryLayout === option.id} onChange={() => onGalleryLayoutChange(option.id)} />{option.title}</span>
          <span className="mt-1 text-xs leading-5 text-slate-500">{option.description}</span>
        </label>)}
      </div>
    </fieldset>
    <div className="grid gap-5 sm:grid-cols-2">
      {layoutPicker('products', productLayout, onProductLayoutChange)}
      {layoutPicker('services', serviceLayout, onServiceLayoutChange)}
    </div>
  </section>;
}
