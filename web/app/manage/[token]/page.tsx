import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import Dashboard from '@/components/manage/Dashboard';
import type { LeadsResponse, ManageBusiness } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'ניהול העסק',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

const TOKEN_RE = /^[A-Za-z0-9_-]{43,128}$/;

export default async function ManagePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!TOKEN_RE.test(token)) notFound();

  const xff = (await headers()).get('x-forwarded-for');
  const get = async <T,>(sub: string): Promise<T | null> => {
    const res = await fetch(`${process.env.API_URL}/api/manage/${token}/${sub}`, {
      cache: 'no-store',
      headers: xff ? { 'x-forwarded-for': xff } : {},
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`backend ${res.status}`);
    return res.json() as Promise<T>;
  };

  const [biz, leads] = await Promise.all([
    get<ManageBusiness>('business'),
    get<LeadsResponse>('leads?limit=25'),
  ]);
  if (!biz || !leads) notFound(); // invalid, expired or revoked token: same page as any 404

  return <Dashboard token={token} initialBusiness={biz} initialLeads={leads} />;
}