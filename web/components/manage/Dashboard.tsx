'use client';

import { useState } from 'react';
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
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <div className="mx-auto max-w-5xl p-4">
        <header className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div>
            <h1 className="text-xl font-bold">{biz.name}</h1>
            <p className="text-sm text-gray-500">ממשק ניהול</p>
          </div>
          <a href={`/biz/${biz.slug}`} target="_blank" rel="noopener noreferrer"
            className="rounded-full bg-white px-4 py-2 text-sm ring-1 ring-gray-300">צפייה באתר ↗</a>
        </header>

        <nav className="flex flex-wrap gap-2" aria-label="ניווט">
          {TABS.map(([id, label]) => (
            <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)}
              className={`rounded-full px-4 py-2 text-sm font-medium ${tab === id ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 ring-1 ring-gray-300'}`}>
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