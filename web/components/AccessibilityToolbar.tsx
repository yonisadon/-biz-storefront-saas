'use client';

import { useEffect, useState } from 'react';

type Prefs = { large: boolean; contrast: boolean; links: boolean };
const KEY = 'a11y-prefs';
const OFF: Prefs = { large: false, contrast: false, links: false };

function apply(p: Prefs) {
  const c = document.documentElement.classList;
  c.toggle('a11y-large', p.large);
  c.toggle('a11y-contrast', p.contrast);
  c.toggle('a11y-links', p.links);
}

export default function AccessibilityToolbar({ statementHref }: { statementHref?: string }) {
  const [open, setOpen] = useState(false);
  const [p, setP] = useState<Prefs>(OFF);

  useEffect(() => {
    try {
      const s = localStorage.getItem(KEY);
      if (s) { const v = { ...OFF, ...JSON.parse(s) }; setP(v); apply(v); }
    } catch { /* storage unavailable */ }
  }, []);

  const update = (next: Prefs) => {
    setP(next); apply(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };

  const row = (key: keyof Prefs, label: string) => (
    <button type="button" aria-pressed={p[key]} onClick={() => update({ ...p, [key]: !p[key] })}
      className={`w-full rounded-lg border px-3 py-2 text-start text-sm ${p[key] ? 'bg-ink text-surface' : 'border-ink/25'}`}>
      {label}
    </button>
  );

  return (
    <div className="fixed bottom-20 end-3 z-50 sm:bottom-5 sm:end-5">
      <button type="button" aria-expanded={open} aria-controls="a11y-panel" onClick={() => setOpen(!open)}
        className="flex h-11 w-11 items-center justify-center rounded-full border border-ink/15 bg-surface/95 text-ink shadow-md backdrop-blur transition hover:-translate-y-0.5 hover:shadow-lg">
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-7 w-7" fill="currentColor"><circle cx="12" cy="3.8" r="2.1"/><path d="M11.1 7.1a2 2 0 0 1 2.1 1.1l1.1 3h4.1a1.5 1.5 0 0 1 0 3h-5.1a1.8 1.8 0 0 1-1.7-1.2l-.5-1.3-1.2 4.1 3.6 2.4a1.6 1.6 0 0 1-1.8 2.6l-4.4-3a2.1 2.1 0 0 1-.8-2.4l1.4-4.8-1.5 1.3-1.2 2.3a1.5 1.5 0 1 1-2.7-1.4l1.5-2.9a2 2 0 0 1 .5-.6l3-2.2a2.1 2.1 0 0 1 1.6-.4Z"/></svg>
      </button>
      {open && (
        <div id="a11y-panel" role="region" aria-label="כלי נגישות"
          className="absolute bottom-14 end-0 w-60 space-y-2 rounded-xl border border-ink/20 bg-surface p-3 text-ink shadow-xl">
          {row('large', 'הגדלת טקסט')}
          {row('contrast', 'ניגודיות גבוהה')}
          {row('links', 'הדגשת קישורים')}
          <button type="button" onClick={() => update(OFF)} className="w-full rounded-lg border border-ink/25 px-3 py-2 text-start text-sm">איפוס</button>
          {statementHref && <a href={statementHref} className="block px-1 pt-1 text-sm underline">הצהרת נגישות</a>}
        </div>
      )}
    </div>
  );
}