'use client';

import { useEffect, useRef, useState } from 'react';

type Prefs = {
  fontScale: 0 | 1 | 2 | 3;
  contrast: boolean;
  links: boolean;
  spacing: boolean;
  readableFont: boolean;
  focus: boolean;
  reduceMotion: boolean;
};
const KEY = 'a11y-prefs';
const OFF: Prefs = {
  fontScale: 0,
  contrast: false,
  links: false,
  spacing: false,
  readableFont: false,
  focus: false,
  reduceMotion: false,
};

function normalizePrefs(value: unknown): Prefs {
  if (!value || typeof value !== 'object') return OFF;
  const candidate = value as Partial<Prefs>;
  const scale = Number(candidate.fontScale);
  return {
    fontScale: ([0, 1, 2, 3].includes(scale) ? scale : candidate.fontScale === true ? 1 : 0) as Prefs['fontScale'],
    contrast: candidate.contrast === true,
    links: candidate.links === true,
    spacing: candidate.spacing === true,
    readableFont: candidate.readableFont === true,
    focus: candidate.focus === true,
    reduceMotion: candidate.reduceMotion === true,
  };
}

function apply(p: Prefs) {
  const c = document.documentElement.classList;
  c.toggle('a11y-font-1', p.fontScale === 1);
  c.toggle('a11y-font-2', p.fontScale === 2);
  c.toggle('a11y-font-3', p.fontScale === 3);
  c.toggle('a11y-contrast', p.contrast);
  c.toggle('a11y-links', p.links);
  c.toggle('a11y-spacing', p.spacing);
  c.toggle('a11y-readable-font', p.readableFont);
  c.toggle('a11y-focus', p.focus);
  c.toggle('a11y-reduce-motion', p.reduceMotion);
}

export default function AccessibilityToolbar({ statementHref }: { statementHref?: string }) {
  const [open, setOpen] = useState(false);
  const [p, setP] = useState<Prefs>(OFF);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(KEY);
      if (stored) {
        const value = normalizePrefs(JSON.parse(stored));
        setP(value);
        apply(value);
      }
    } catch { /* storage unavailable or invalid data */ }
  }, []);

  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const update = (next: Prefs) => {
    setP(next);
    apply(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* preferences still apply for this page */ }
  };

  const toggle = (key: Exclude<keyof Prefs, 'fontScale'>, label: string) => (
    <button
      key={key}
      type="button"
      aria-pressed={p[key]}
      onClick={() => update({ ...p, [key]: !p[key] })}
      className={`min-h-11 w-full rounded-lg border px-3 py-2 text-start text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 ${p[key] ? 'border-primary bg-primary text-primary-fg' : 'border-ink/25 bg-surface text-ink'}`}
    >
      {label}: {p[key] ? 'פעיל' : 'כבוי'}
    </button>
  );

  return (
    <div className="fixed bottom-28 end-3 z-50 sm:bottom-5 sm:end-5">
      <button
        ref={triggerRef}
        type="button"
        aria-label="פתיחת כלי נגישות"
        aria-expanded={open}
        aria-controls="a11y-panel"
        onClick={() => setOpen((value) => !value)}
        className="flex h-11 w-11 items-center justify-center rounded-full border border-ink/20 bg-surface text-ink shadow-lg ring-1 ring-black/5 transition hover:shadow-xl focus-visible:outline-2 focus-visible:outline-offset-2"
        style={{ color: 'var(--brand-primary)' }}
      >
        <svg aria-hidden="true" viewBox="0 0 16 16" fill="currentColor" className="h-6 w-6 shrink-0">
          <path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1" />
          <path d="M8 3.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2M3 6a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-3l-.5 3.5 1.5 3a.5.5 0 0 1-.9.4L8 10.5l-1.6 2.9a.5.5 0 0 1-.9-.4l1.5-3L6.5 6.5h-3A.5.5 0 0 1 3 6" />
        </svg>
      </button>
      {open && (
        <section
          id="a11y-panel"
          role="dialog"
          aria-modal="false"
          aria-labelledby="a11y-title"
          className="absolute bottom-14 end-0 max-h-[min(75vh,36rem)] w-[min(19rem,calc(100vw-1.5rem))] space-y-3 overflow-y-auto rounded-xl border border-ink/20 bg-surface p-3 text-ink shadow-xl"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 id="a11y-title" className="text-base font-bold">כלי נגישות</h2>
            <button ref={closeRef} type="button" onClick={() => { setOpen(false); triggerRef.current?.focus(); }} className="min-h-11 min-w-11 rounded-lg border border-ink/25 px-3 text-sm" aria-label="סגירת כלי הנגישות">סגירה</button>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-semibold">גודל טקסט</p>
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              <button type="button" className="min-h-11 rounded-lg border border-ink/25 px-3 text-sm" onClick={() => update({ ...p, fontScale: Math.max(0, p.fontScale - 1) as Prefs['fontScale'] })} disabled={p.fontScale === 0} aria-label="הקטנת טקסט">א−</button>
              <span className="min-w-16 text-center text-sm" aria-live="polite">{['רגיל', 'גדול', 'גדול מאוד', 'הכי גדול'][p.fontScale]}</span>
              <button type="button" className="min-h-11 rounded-lg border border-ink/25 px-3 text-sm" onClick={() => update({ ...p, fontScale: Math.min(3, p.fontScale + 1) as Prefs['fontScale'] })} disabled={p.fontScale === 3} aria-label="הגדלת טקסט">א+</button>
            </div>
          </div>
          <div className="space-y-2">
            {toggle('contrast', 'ניגודיות גבוהה')}
            {toggle('links', 'הדגשת קישורים')}
            {toggle('spacing', 'ריווח טקסט')}
            {toggle('readableFont', 'גופן קריא')}
            {toggle('focus', 'הדגשת מיקוד מקלדת')}
            {toggle('reduceMotion', 'צמצום אנימציות')}
          </div>
          <button type="button" onClick={() => update(OFF)} className="min-h-11 w-full rounded-lg border border-ink/25 px-3 py-2 text-start text-sm font-semibold">איפוס כל ההגדרות</button>
          {statementHref && <a href={statementHref} className="block min-h-11 px-1 pt-1 text-sm underline underline-offset-4">הצהרת נגישות</a>}
          <p className="text-xs leading-5 text-ink/70">הכלים משנים את תצוגת האתר בלבד ואינם מחליפים התאמות נגישות בתוכן עצמו.</p>
        </section>
      )}
    </div>
  );
}
