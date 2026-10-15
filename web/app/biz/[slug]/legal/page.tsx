import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getCtx, getLegal, getStorefront } from '@/lib/api';
import { LEGAL_DOCS, LEGAL_TITLES } from '@/lib/legalDefaults';
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
  const [biz, ...documents] = await Promise.all([
    getStorefront(ctx),
    ...LEGAL_DOCS.map((doc) => getLegal(ctx, doc)),
  ]);
  if (!biz) notFound();

  const entries = LEGAL_DOCS.map((doc, i) => ({
    doc,
    title: LEGAL_TITLES[doc],
    text: documents[i]?.custom_text?.trim() || '',
  })).filter((entry) => entry.text);

  return (
    <div className="brand-root min-h-screen bg-surface text-ink" style={themeVars(biz.branding?.colors)}>
      <main className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
        <a href={ctx.base || '/'} className="inline-flex min-h-10 items-center text-sm font-semibold text-primary underline-offset-4 hover:underline">← חזרה לאתר {biz.business.name}</a>
        <header className="mt-5 rounded-3xl border border-ink/10 bg-white p-5 shadow-sm sm:p-8">
          <p className="text-sm font-semibold text-primary">מידע מטעם העסק</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">מידע משפטי ונגישות</h1>
          <p className="mt-3 text-sm leading-6 text-ink/70">המסמכים בעמוד זה נכתבו או הוזנו על ידי העסק. לשאלות בנוגע לתוכן, יש לפנות ישירות לעסק.</p>
          {entries.length > 1 && <nav aria-label="ניווט במסמכים" className="mt-5 flex flex-wrap gap-2">
            {entries.map(({ doc, title }) => <a key={doc} href={`#${doc}`} className="rounded-full border border-ink/15 px-3 py-2 text-sm font-semibold hover:bg-primary/5">{title}</a>)}
          </nav>}
        </header>
        {entries.length ? <div className="mt-4 space-y-4">
          {entries.map(({ doc, title, text }) => <section key={doc} id={doc} aria-labelledby={`${doc}-heading`} className="scroll-mt-5 rounded-3xl border border-ink/10 bg-white p-5 shadow-sm sm:p-8">
            <h2 id={`${doc}-heading`} className="text-xl font-extrabold sm:text-2xl">{title}</h2>
            <div className="mt-4 whitespace-pre-line break-words text-sm leading-7 text-ink/85 sm:text-base">{text}</div>
          </section>)}
        </div> : <p className="mt-4 rounded-2xl border border-dashed border-ink/20 p-6 text-center text-sm leading-6 text-ink/70">העסק עדיין לא פרסם מסמכים בעמוד זה.</p>}
      </main>
    </div>
  );
}
