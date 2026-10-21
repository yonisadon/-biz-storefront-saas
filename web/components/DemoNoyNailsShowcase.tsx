'use client';

import Image from 'next/image';
import { useState } from 'react';

type ShowcaseKind = 'service' | 'product';
type ShowcaseItem = {
  id: string;
  kind: ShowcaseKind;
  name: string;
  description: string;
  price: number;
  image: string;
  alt: string;
};

const photo = (id: string, width = 900) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${width}&q=85`;

// Illustrative catalog content for the Noy Nails demo only. These are not live DB items.
const items: ShowcaseItem[] = [
  { id: 'french', kind: 'service', name: 'פרנץ׳ קלאסי', description: 'מראה נקי ועל־זמני עם קצוות מדויקים וגימור מבריק.', price: 130, image: photo('photo-1772322586754-34c9e6f5be6f'), alt: 'עיצוב ציפורניים בסגנון פרנץ׳' },
  { id: 'nail-art', kind: 'service', name: 'עיצוב ציפורניים', description: 'נגיעות צבע, נצנוץ או עיטורים עדינים בהתאמה לסגנון שלך.', price: 140, image: photo('photo-1762373349045-c2decd4ec3f3'), alt: 'עיצוב ציפורניים עם פרטים דקורטיביים' },
  { id: 'manicure', kind: 'service', name: 'מניקור קלאסי', description: 'טיפוח, סידור ועיצוב הציפורניים למראה נקי ומטופח.', price: 90, image: photo('photo-1632345031435-8727f6897d53'), alt: 'טיפול מניקור מקצועי' },
  { id: 'builder', kind: 'service', name: 'בנייה והארכה', description: 'עיצוב צורת הציפורן והארכה במראה אלגנטי.', price: 150, image: photo('photo-1772322586754-34c9e6f5be6f'), alt: 'ציפורניים ארוכות ומעוצבות' },
  { id: 'polish', kind: 'product', name: 'בקבוקון לק', description: 'גוון לבחירה להשלמת המראה גם בבית.', price: 35, image: photo('photo-1632345031435-8727f6897d53'), alt: 'לק לציפורניים' },
  { id: 'cuticle-oil', kind: 'product', name: 'שמן קוטיקולה', description: 'מוצר טיפוח לשימוש ביתי סביב הציפורניים.', price: 30, image: photo('photo-1762373349045-c2decd4ec3f3'), alt: 'מוצרי טיפוח לציפורניים' },
];

export default function DemoNoyNailsShowcase({ whatsappNumber }: { whatsappNumber: string }) {
  const [filter, setFilter] = useState<'all' | ShowcaseKind>('all');
  const shown = items.filter((item) => filter === 'all' || item.kind === filter);

  return (
    <section aria-labelledby="demo-showcase-heading" className="mt-5 scroll-mt-24 rounded-[1.75rem] border border-ink/10 bg-white p-4 shadow-sm sm:mt-7 sm:p-6 lg:p-8">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold tracking-widest text-primary">הדגמת הקטלוג</p>
          <h2 id="demo-showcase-heading" className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">עוד שירותים ומוצרים</h2>
          <p className="mt-2 text-sm leading-6 text-ink/65">דוגמה לאופן שבו אפשר להציג מגוון פריטים באתר עסקי.</p>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="סינון לפי סוג פריט">
          {([{ value: 'all', label: 'הכול' }, { value: 'service', label: 'שירותים' }, { value: 'product', label: 'מוצרים' }] as const).map((option) => (
            <button key={option.value} type="button" onClick={() => setFilter(option.value)} aria-pressed={filter === option.value}
              className={`min-h-10 rounded-full border px-4 py-2 text-sm font-bold transition ${filter === option.value ? 'border-primary bg-primary text-primary-fg shadow-sm' : 'border-ink/15 bg-white text-ink hover:border-primary/40'}`}>
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((item) => (
          <article key={item.id} className="storefront-card flex flex-col overflow-hidden rounded-2xl border bg-white">
            <div className="relative aspect-[4/3] bg-ink/5">
              <Image src={item.image} alt={item.alt} fill sizes="(min-width:1024px) 33vw, (min-width:640px) 50vw, 100vw" className="object-cover transition-transform duration-500 hover:scale-[1.03]" />
            </div>
            <div className="flex flex-1 flex-col gap-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-bold">{item.name}</h3>
                <span className="shrink-0 rounded-full bg-secondary/30 px-2 py-0.5 text-xs">{item.kind === 'service' ? 'שירות' : 'מוצר'}</span>
              </div>
              <p className="text-sm leading-6 text-ink/70">{item.description}</p>
              <div className="mt-auto flex items-center justify-between gap-3 pt-2">
                <span className="storefront-card-price text-lg font-extrabold">{item.price} ₪</span>
                <a href={`https://wa.me/${whatsappNumber}?text=${encodeURIComponent('שלום, אשמח לקבל פרטים לגבי ' + item.name)}`} target="_blank" rel="noopener noreferrer"
                  className="storefront-card-action rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-fg transition hover:opacity-90">לפרטים</a>
              </div>
            </div>
          </article>
        ))}
      </div>
      <p className="mt-4 text-xs leading-5 text-ink/55">התמונות, הפריטים והמחירים באזור ההדגמה נועדו להמחשה בלבד ואינם הצעת מחיר מחייבת.</p>
    </section>
  );
}
