import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getCtx, getLegal, getStorefront } from '@/lib/api';
import { LEGAL_DOCS, LEGAL_DEFAULTS, LEGAL_TITLES, LEGAL_LAST_UPDATED } from '@/lib/legalDefaults';
import { themeVars } from '@/lib/theme';

export const revalidate = 60;
type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const ctx = await getCtx(slug);
  const biz = await getStorefront(ctx);
  return { title: biz?.business?.name ? `מידע משפטי ונגישות | ${biz.business.name}` : 'מידע משפטי ונגישות', robots: { index: false } };
}

export default async function LegalPage({ params }: Props) {
  const { slug } = await params;
  const ctx = await getCtx(slug);
  const [biz, terms, privacy, accessibility] = await Promise.all([
    getStorefront(ctx),
    getLegal(ctx, 'terms_of_use'),
    getLegal(ctx, 'privacy_policy'),
    getLegal(ctx, 'accessibility_statement'),
  ]);
  const documents = [terms, privacy, accessibility];
  if (!biz) notFound();

  const entries = LEGAL_DOCS.map((doc, i) => ({
    doc,
    title: LEGAL_TITLES[doc],
    platformText: LEGAL_DEFAULTS[doc],
    businessText: documents[i]?.custom_text?.trim() || '',
  }));

  return (
    <div className="brand-root min-h-screen bg-surface text-ink" style={themeVars(biz.branding?.colors)}>
      <a href="#legal-main" className="sr-only z-[100] rounded-md bg-white px-4 py-3 font-bold text-black focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:outline-4 focus:outline-offset-2 focus:outline-black">דילוג לתוכן המרכזי</a>
      <main id="legal-main" tabIndex={-1} className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
        <a href={ctx.base || '/'} className="inline-flex min-h-11 items-center text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">← חזרה לאתר {biz.business.name}</a>
        <header className="mt-5 rounded-3xl border border-ink/10 bg-white p-5 shadow-sm sm:p-8">
          <p className="text-sm font-semibold text-primary">מידע מטעם Biz Storefront והעסק</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">מידע משפטי ונגישות</h1>
          <p className="mt-3 text-sm leading-6 text-ink/70">כל מסמך כולל מידע קבוע מטעם הפלטפורמה והשלמות שהעסק בחר להוסיף. לשאלות על פעילות העסק או על ההשלמות שלו, יש לפנות ישירות לעסק.</p>
          <p className="mt-2 text-xs text-ink/60">עודכן לאחרונה: {LEGAL_LAST_UPDATED}</p>
          <nav aria-label="ניווט במסמכים" className="mt-5 flex flex-wrap gap-2">
            {entries.map(({ doc, title }) => <a key={doc} href={`#${doc}`} className="rounded-full border border-ink/15 px-3 py-2 text-sm font-semibold hover:bg-primary/5">{title}</a>)}
          </nav>
        </header>
        <div className="mt-4 space-y-4">
          {entries.map(({ doc, title, platformText, businessText }) => <section key={doc} id={doc} aria-labelledby={`${doc}-heading`} className="scroll-mt-5 rounded-3xl border border-ink/10 bg-white p-5 shadow-sm sm:p-8">
            <h2 id={`${doc}-heading`} className="text-xl font-extrabold sm:text-2xl">{title}</h2>
            <div className="mt-4 whitespace-pre-line break-words text-sm leading-7 text-ink/85 sm:text-base">{platformText}</div>
            {businessText && <>
              <h3 className="mt-6 border-t border-ink/10 pt-5 text-base font-bold">השלמות מטעם העסק</h3>
              <div className="mt-3 whitespace-pre-line break-words text-sm leading-7 text-ink/85 sm:text-base">{businessText}</div>
            </>}
            {doc === 'accessibility_statement' && !businessText && <p role="note" className="mt-5 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-amber-950">לתשומת לבכם: העסק עדיין לא הוסיף פרטים על התאמות הנגישות באתר שלו, מגבלות ידועות ודרך יצירת קשר בנושא.</p>}
          </section>)}
        </div>
      </main>
    </div>
  );
}
