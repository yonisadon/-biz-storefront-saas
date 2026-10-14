'use client';

import { useState } from 'react';
import { themeVars } from '@/lib/theme';
import type { LeadsResponse, ManageBusiness } from '@/lib/types';
import BusinessPanel from './BusinessPanel';
import GalleryPanel from './GalleryPanel';
import HoursPanel from './HoursPanel';
import LeadsPanel from './LeadsPanel';
import ProductsPanel from './ProductsPanel';

type Tab = 'leads' | 'products' | 'gallery' | 'hours' | 'business';
const TABS: [Tab, string][] = [
  ['leads', 'פניות'], ['products', 'מוצרים'], ['gallery', 'גלריה'], ['hours', 'שעות'], ['business', 'פרטי העסק'],
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
      <div className="mx-auto max-w-5xl p-4 sm:p-6">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ink/10 py-4">
          <div>
            <h1 className="text-xl font-bold">{biz.name}</h1>
            <p className="mt-1 text-sm text-ink/65">ממשק ניהול</p>
          </div>
          <a href={`/biz/${biz.slug}`} target="_blank" rel="noopener noreferrer"
            className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-fg hover:opacity-90">
            צפייה באתר ↗
          </a>
        </header>

        <nav className="mt-4 flex flex-wrap gap-2" aria-label="ניווט">
          {TABS.map(([id, label]) => (
            <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)}
              className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${tab === id ? 'bg-primary text-primary-fg' : 'bg-white text-ink ring-1 ring-ink/15 hover:bg-primary/5'}`}>
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
        </div>
      </div>
    </div>
  );
}
