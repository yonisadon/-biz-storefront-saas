'use client';

import { useState } from 'react';
import { DAYS } from '@/lib/labels';
import { mcall } from '@/lib/manageApi';
import type { ManageBusiness } from '@/lib/types';

type Range = { open: string; close: string };
type Day = 'closed' | Range[];

const work: Day = [{ open: '09:00', close: '17:00' }];
const DEFAULT: Record<string, Day> = {
  sun: work, mon: work, tue: work, wed: work, thu: work, fri: 'closed', sat: 'closed',
};

export default function HoursPanel({ token, biz, onSaved }: {
  token: string; biz: ManageBusiness; onSaved: (b: ManageBusiness) => void;
}) {
  const oh = biz.config.opening_hours ?? {};
  const [days, setDays] = useState<Record<string, Day>>(oh.days ?? DEFAULT);
  const [bannerOn, setBannerOn] = useState<boolean>(oh.out_of_hours_banner?.enabled !== false);
  const [bannerMsg, setBannerMsg] = useState<string>(oh.out_of_hours_banner?.message ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const setDay = (k: string, d: Day) => setDays((s) => ({ ...s, [k]: d }));
  const setRange = (k: string, i: number, patch: Partial<Range>) => {
    const d = days[k];
    if (d === 'closed') return;
    setDay(k, d.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };

  function validate(): string | null {
    for (const [k, label] of DAYS) {
      const d = days[k];
      if (!d || d === 'closed') continue;
      const sorted = [...d].sort((a, b) => a.open.localeCompare(b.open));
      for (let i = 0; i < sorted.length; i++) {
        const r = sorted[i];
        if (!r.open || !r.close || r.open >= r.close) return `${label}: שעת הסיום חייבת להיות אחרי שעת ההתחלה (משמרת לילה אינה נתמכת).`;
        if (i > 0 && sorted[i - 1].close > r.open) return `${label}: טווחי השעות חופפים.`;
      }
    }
    return null;
  }

  async function save() {
    const problem = validate();
    if (problem) return setMsg({ ok: false, text: problem });
    setBusy(true); setMsg(null);
    try {
      const saved = await mcall<Partial<ManageBusiness>>(token, 'business', {
        method: 'PATCH',
        body: JSON.stringify({
          // Replaces the whole opening_hours section, so send days AND banner together
          config: {
            opening_hours: {
              days,
              out_of_hours_banner: { enabled: bannerOn, ...(bannerMsg.trim() ? { message: bannerMsg.trim() } : {}) },
            },
          },
        }),
      });
      onSaved({ ...biz, ...saved });
      setMsg({ ok: true, text: 'שעות הפעילות נשמרו.' });
    } catch { setMsg({ ok: false, text: 'השמירה נכשלה. נסו שוב.' }); }
    finally { setBusy(false); }
  }

  const time = 'w-[108px] rounded-md border border-gray-300 bg-white px-1.5 py-1 text-sm';

  return (
    <section aria-label="שעות פעילות" className="rounded-xl border border-ink/15 bg-white p-3 sm:p-4">
      <h2 className="text-lg font-bold">שעות פעילות</h2>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {DAYS.map(([k, label]) => {
          const d = days[k] ?? 'closed';
          const open = d !== 'closed';
          return (
            <div key={k} className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg border border-gray-100 px-3 py-2">
              <label className="flex w-24 shrink-0 items-center gap-2 font-medium">
                <input type="checkbox" checked={open}
                  onChange={(e) => setDay(k, e.target.checked ? [{ open: '09:00', close: '17:00' }] : 'closed')} />
                {label}
              </label>
              {open ? (
                <div className="min-w-0 flex-1 space-y-1.5">
                  {d.map((r, i) => (
                    <div key={i} className="flex items-center gap-2" dir="ltr">
                      <input type="time" className={time} value={r.open} aria-label={`${label}: שעת פתיחה`}
                        onChange={(e) => setRange(k, i, { open: e.target.value })} />
                      <span>–</span>
                      <input type="time" className={time} value={r.close} aria-label={`${label}: שעת סגירה`}
                        onChange={(e) => setRange(k, i, { close: e.target.value })} />
                      {d.length > 1 && (
                        <button type="button" aria-label="הסרת טווח" className="px-2 text-lg text-red-700"
                          onClick={() => setDay(k, d.filter((_, idx) => idx !== i))}>×</button>
                      )}
                    </div>
                  ))}
                  {d.length < 3 && (
                    <button type="button" className="text-sm underline"
                      onClick={() => setDay(k, [...d, { open: '16:00', close: '20:00' }])}>+ הוספת טווח</button>
                  )}
                </div>
              ) : <span className="text-gray-500">סגור</span>}
            </div>
          );
        })}
      </div>

      <div className="mt-3 space-y-2 border-t border-gray-100 pt-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={bannerOn} onChange={(e) => setBannerOn(e.target.checked)} />
          להציג באנר באתר מחוץ לשעות הפעילות
        </label>
        {bannerOn && (
          <input className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" maxLength={200}
            placeholder="אנחנו סגורים כרגע. השאירו פנייה ונחזור אליכם בשעות הפעילות."
            aria-label="הודעת הבאנר" value={bannerMsg} onChange={(e) => setBannerMsg(e.target.value)} />
        )}
      </div>

      {msg && (
        <p role={msg.ok ? 'status' : 'alert'}
          className={`mt-3 rounded-lg p-2 text-sm ${msg.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>{msg.text}</p>
      )}
      <button type="button" onClick={save} disabled={busy}
        className="mt-3 rounded-full bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
        {busy ? 'שומר…' : 'שמירה'}
      </button>
    </section>
  );
}