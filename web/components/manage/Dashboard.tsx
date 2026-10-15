'use client';

import { useState } from 'react';
import { themeVars } from '@/lib/theme';
import type { LeadsResponse, ManageBusiness } from '@/lib/types';
import BusinessPanel from './BusinessPanel';
import GalleryPanel from './GalleryPanel';
import HoursPanel from './HoursPanel';
import LeadsPanel from './LeadsPanel';
import LegalPanel from './LegalPanel';
import ProductsPanel from './ProductsPanel';

type Tab = 'leads' | 'products' | 'gallery' | 'hours' | 'business' | 'legal';
const TABS: [Tab, string][] = [
  ['leads', 'פניות'], ['products', 'מוצרים'], ['gallery', 'גלריה'], ['hours', 'שעות'], ['business', 'פרטי העסק'], ['legal', 'מסמכי האתר'],
];

export default function Dashboard({ token, initialBusiness, initialLeads }: {
  token: string; initialBusiness: ManageBusiness; initialLeads: LeadsResponse;
}) {
  const [tab, setTab] = useState<Tab>('leads');
  const [biz, setBiz] = useState(initialBusiness);

  return (
    <div
      className="brand-root min-h-screen bg-surface text-ink"
      style={themeVars(biz.config?.branding?.colors)}
    >
      <div className="mx-auto max-w-6xl p-3 sm:p-6">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-ink/10 bg-white px-4 py-4 shadow-sm sm:px-5">
          <div>
            <p className="text-xs font-semibold text-ink/55">אזור אישי לעסק</p>
            <h1 className="mt-1 text-xl font-extrabold tracking-tight">{biz.name}</h1>
            <p className="mt-1 text-sm text-ink/65">ניהול האתר, הפניות והתוכן במקום אחד</p>
          </div>
          <a href={`/biz/${biz.slug}`} target="_blank" rel="noopener noreferrer"
            className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-fg hover:opacity-90">
            צפייה באתר ↗
          </a>
        </header>

        <nav className="mt-4 flex gap-2 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="ניווט">
          {TABS.map(([id, label]) => (
            <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)}
              className={`min-h-11 shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold transition-colors ${tab === id ? 'bg-primary text-primary-fg shadow-sm' : 'bg-white text-ink ring-1 ring-ink/15 hover:bg-primary/5'}`}>
              {label}
            </button>
          ))}
        </nav>

        <div className="mt-4">
          {tab === 'leads' && <LeadsPanel token={token} initial={initialLeads} />}
          {tab === 'products' && <ProductsPanel token={token} />}
          {tab === 'gallery' && <GalleryPanel token={token} />}
          {tab === 'hours' && <HoursPanel token={token} biz={biz} onSaved={setBiz} />}
          {tab === 'business' && <BusinessPanel token={token} biz={biz} onSaved={setBiz} />}
          {tab === 'legal' && <LegalPanel token={token} biz={biz} onSaved={setBiz} />}
        </div>
      </div>
    </div>
  );
}
