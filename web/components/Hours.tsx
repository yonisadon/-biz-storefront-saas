import { DAYS } from '@/lib/labels';
import type { DayHours } from '@/lib/types';

export default function Hours({ days }: { days: Record<string, DayHours> }) {
  return (
    <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-8 gap-y-1.5 text-ink/85">
      {DAYS.map(([key, label]) => {
        const d = days[key];
        return (
          <div key={key} className="contents">
            <dt className="font-medium">{label}</dt>
            <dd>
              {!d || d === 'closed'
                ? 'סגור'
                : d.map((r, i) => (
                    <span key={i} dir="ltr" className="me-3 inline-block">{r.open}–{r.close}</span>
                  ))}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}