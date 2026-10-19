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
    <div className="fixed bottom-28 end-3 z-50 sm:bottom-5 sm:end-5">
      <button type="button" aria-label="פתיחת כלי נגישות" aria-expanded={open} aria-controls="a11y-panel" onClick={() => setOpen(!open)}
        className="flex h-11 w-11 items-center justify-center rounded-full border border-ink/20 bg-surface text-ink shadow-lg ring-1 ring-black/5 transition hover:shadow-xl focus-visible:outline-2 focus-visible:outline-offset-2"
        style={{ color: 'var(--brand-primary)' }}>
        <svg aria-hidden="true" viewBox="0 0 16 16" fill="currentColor" className="h-6 w-6 shrink-0">
          <path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1" />
          <path d="M8 3.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2M3 6a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-3l-.5 3.5 1.5 3a.5.5 0 0 1-.9.4L8 10.5l-1.6 2.9a.5.5 0 0 1-.9-.4l1.5-3L6.5 6.5h-3A.5.5 0 0 1 3 6" />
        </svg>
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
