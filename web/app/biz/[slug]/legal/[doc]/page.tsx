import { notFound, redirect } from 'next/navigation';
import { isLegalDoc } from '@/lib/legalDefaults';

type Props = { params: Promise<{ slug: string; doc: string }> };

export default async function LegacyLegalPage({ params }: Props) {
  const { slug, doc } = await params;
  if (!isLegalDoc(doc)) notFound();
  redirect(`/biz/${slug}/legal#${doc}`);
}
