import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getCtx, getLegal, getStorefront } from '@/lib/api';
import { LEGAL_DEFAULTS, LEGAL_TITLES, isLegalDoc } from '@/lib/legalDefaults';
import { themeVars } from '@/lib/theme';

export const revalidate = 60;
type Props = { params: Promise<{ slug: string; doc: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { doc } = await params;
  return { title: isLegalDoc(doc) ? LEGAL_TITLES[doc] : 'מסמך', robots: { index: false } };
}

export default async function LegalPage({ params }: Props) {
  const { slug, doc } = await params;
  if (!isLegalDoc(doc)) notFound();

  const ctx = await getCtx(slug);
  const [biz, legal] = await Promise.all([getStorefront(ctx), getLegal(ctx, doc)]);
  if (!biz || !legal) notFound();

  return (
    <div className="brand-root min-h-screen bg-surface text-ink" style={themeVars(biz.branding?.colors)}>
      <main className="mx-auto max-w-3xl px-4 py-10">
        <a href={ctx.base || '/'} className="text-sm underline">← {biz.business.name}</a>
        <h1 className="mt-4 text-3xl font-bold">{LEGAL_TITLES[doc]}</h1>
        <div className="mt-6 whitespace-pre-line leading-relaxed text-ink/85">
          {legal.custom_text ?? LEGAL_DEFAULTS[doc]}
        </div>
      </main>
    </div>
  );
}