import { DAYS } from '@/lib/labels';
import type { DayHours } from '@/lib/types';

export default function Hours({
  days,
  openNow,
}: {
  days: Record<string, DayHours>;
  openNow?: boolean | null;
}) {
  return (
    <section
      aria-label="שעות פעילות"
      className="rounded-xl border border-ink/15 bg-surface px-3 py-2.5"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span aria-hidden="true" className="text-base">◷</span>
        <h2 className="font-semibold">שעות פעילות</h2>
        {openNow === true && (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">
            פתוח עכשיו
          </span>
        )}
        {openNow === false && (
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
            סגור עכשיו
          </span>
        )}
        <details className="ms-auto">
          <summary className="cursor-pointer list-none rounded-full px-2 py-1 text-sm font-medium text-primary hover:bg-primary/5">
            כל שעות הפעילות
          </summary>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 border-t border-ink/10 pt-3 text-sm text-ink/85">
            {DAYS.map(([key, label]) => {
              const d = days[key];
              return (
                <div key={key} className="contents">
                  <dt className="font-medium">{label}</dt>
                  <dd>
                    {!d || d === 'closed'
                      ? 'סגור'
                      : d.map((r, i) => (
                          <span key={i} dir="ltr" className="me-3 inline-block whitespace-nowrap">
                            {r.open}–{r.close}
                          </span>
                        ))}
                  </dd>
                </div>
              );
            })}
          </dl>
        </details>
      </div>
    </section>
  );
}
