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

export default function AccessibilityToolbar({ statementHref }: { statementHref: string }) {
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
    <div className="fixed start-3 top-3 z-50">
      <button type="button" aria-expanded={open} aria-controls="a11y-panel" onClick={() => setOpen(!open)}
        className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-fg shadow-lg">
        <span aria-hidden="true" className="me-1">♿</span>נגישות
      </button>
      {open && (
        <div id="a11y-panel" role="region" aria-label="כלי נגישות"
          className="mt-2 w-60 space-y-2 rounded-xl border border-ink/20 bg-surface p-3 text-ink shadow-xl">
          {row('large', 'הגדלת טקסט')}
          {row('contrast', 'ניגודיות גבוהה')}
          {row('links', 'הדגשת קישורים')}
          <button type="button" onClick={() => update(OFF)} className="w-full rounded-lg border border-ink/25 px-3 py-2 text-start text-sm">איפוס</button>
          <a href={statementHref} className="block px-1 pt-1 text-sm underline">הצהרת נגישות</a>
        </div>
      )}
    </div>
  );
}