'use client';

import { useMemo } from 'react';

type Appointment = {
  id: string;
  service_name: string;
  start_at: string;
  end_at: string;
  source: 'website' | 'manual';
  status: 'reserved' | 'cancelled';
};
type TimeBlock = { id: string; start_at: string; end_at: string; reason: string | null };
type OpeningRange = { open: string; close: string };
type Props = {
  mode: 'day' | 'week';
  dates: string[];
  selectedDate: string;
  appointments: Appointment[];
  blocks: TimeBlock[];
  openingDays: Record<string, unknown> | null;
  onSelectDate: (date: string) => void;
  onSelectAppointment: (id: string) => void;
};

function minuteOf(value: string) {
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
}
function minuteOnDay(value: string, day: string) {
  const eventDay = value.slice(0, 10);
  if (eventDay < day) return 0;
  if (eventDay > day) return 24 * 60;
  return minuteOf(value.slice(11, 16));
}
function dayLabel(day: string) {
  return new Intl.DateTimeFormat('he-IL', {
    weekday: 'short', day: 'numeric', month: 'numeric', timeZone: 'UTC',
  }).format(new Date(day + 'T12:00:00Z'));
}
function clockLabel(value: string) {
  return value.slice(11, 16);
}

export default function CalendarTimeline({
  mode, dates, selectedDate, appointments, blocks, openingDays, onSelectDate, onSelectAppointment,
}: Props) {
  const bounds = useMemo(() => {
    let earliest = 24 * 60;
    let latest = 0;
    for (const day of dates) {
      const weekday = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date(day + 'T12:00:00Z').getUTCDay()];
      const dayRanges = openingDays?.[weekday];
      if (Array.isArray(dayRanges)) {
        for (const range of dayRanges) {
          if (!range || typeof range !== 'object' ||
              typeof (range as OpeningRange).open !== 'string' ||
              typeof (range as OpeningRange).close !== 'string') continue;
          earliest = Math.min(earliest, minuteOf((range as OpeningRange).open));
          latest = Math.max(latest, minuteOf((range as OpeningRange).close));
        }
      }
      for (const item of appointments) {
        if (item.start_at.slice(0, 10) <= day && item.end_at.slice(0, 10) >= day) {
          earliest = Math.min(earliest, minuteOnDay(item.start_at, day));
          latest = Math.max(latest, minuteOnDay(item.end_at, day));
        }
      }
      for (const block of blocks) {
        if (block.start_at.slice(0, 10) <= day && block.end_at.slice(0, 10) >= day) {
          earliest = Math.min(earliest, minuteOnDay(block.start_at, day));
          latest = Math.max(latest, minuteOnDay(block.end_at, day));
        }
      }
    }
    if (earliest === 24 * 60 || latest === 0) return { start: 8 * 60, end: 20 * 60 };
    const start = Math.max(0, Math.floor(earliest / 60) * 60);
    const end = Math.min(24 * 60, Math.ceil(latest / 60) * 60);
    return { start, end: end > start ? end : Math.min(24 * 60, start + 60) };
  }, [dates, openingDays, appointments, blocks]);

  const hours = useMemo(() => Array.from(
    { length: Math.floor((bounds.end - bounds.start) / 60) + 1 },
    (_, index) => bounds.start + index * 60,
  ), [bounds]);
  const timelineHeight = ((bounds.end - bounds.start) / 60) * 64;

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-3" aria-label={mode === 'day' ? 'לוח יומי' : 'לוח שבועי'}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold">{mode === 'day' ? 'לוח יומי' : 'לוח שבועי'}</h3>
        {mode === 'week' && <p className="text-xs text-gray-500 sm:hidden">גללו לצדדים כדי לראות את כל הימים.</p>}
        <div className="flex flex-wrap gap-3 text-xs text-gray-600">
          <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-blue-200"/> נקבע באתר</span>
          <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-violet-200"/> תור ידני</span>
          <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-gray-300"/> חסימה</span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <div className={mode === 'day' ? 'min-w-[320px]' : 'min-w-[1120px]'}>
          <div className="grid" style={{ gridTemplateColumns: mode === 'day' ? '56px minmax(250px, 1fr)' : '56px repeat(7, minmax(150px, 1fr))' }}>
            <div className="border-b border-gray-200 p-2 text-xs text-gray-500">שעה</div>
            {dates.map((day) => (
              <button key={day} type="button" onClick={() => onSelectDate(day)}
                aria-pressed={selectedDate === day}
                className="border-b border-s border-gray-200 p-2 text-center text-xs font-semibold hover:bg-gray-50">
                {dayLabel(day)}
              </button>
            ))}
            <div className="relative border-e border-gray-200" style={{ height: timelineHeight }}>
              {hours.map((minute) => (
                <div key={minute} className="absolute inset-x-0 -translate-y-1/2 pe-2 text-end text-[10px] text-gray-500"
                  style={{ top: ((minute - bounds.start) / 60) * 64 }}>
                  {String(Math.floor(minute / 60)).padStart(2, '0')}:00
                </div>
              ))}
            </div>
            {dates.map((day) => {
              const dayAppointments = appointments.filter((item) =>
                item.start_at.slice(0, 10) <= day && item.end_at.slice(0, 10) >= day);
              const dayBlocks = blocks.filter((item) =>
                item.start_at.slice(0, 10) <= day && item.end_at.slice(0, 10) >= day);
              return (
                <div key={day} className="relative border-e border-gray-200 bg-white" style={{ height: timelineHeight }}>
                  {hours.map((minute) => (
                    <div key={minute} className="absolute inset-x-0 border-t border-dashed border-gray-200"
                      style={{ top: ((minute - bounds.start) / 60) * 64 }} />
                  ))}
                  {dayBlocks.map((block) => {
                    const start = Math.max(bounds.start, minuteOnDay(block.start_at, day));
                    const end = Math.min(bounds.end, minuteOnDay(block.end_at, day));
                    if (end <= start) return null;
                    return (
                      <div key={block.id} className="absolute inset-x-1 z-10 overflow-hidden rounded-md border border-dashed border-gray-400 bg-gray-200/90 px-1 py-0.5 text-[10px] text-gray-700"
                        style={{ top: ((start - bounds.start) / 60) * 64, height: Math.max(18, ((end - start) / 60) * 64) }}>
                        חסימה{block.reason ? ' · ' + block.reason : ''}
                      </div>
                    );
                  })}
                  {dayAppointments.map((item) => {
                    const start = Math.max(bounds.start, minuteOnDay(item.start_at, day));
                    const end = Math.min(bounds.end, minuteOnDay(item.end_at, day));
                    if (end <= start) return null;
                    const cancelled = item.status === 'cancelled';
                    const sourceClass = cancelled
                      ? 'border-gray-300 bg-gray-100 text-gray-500 line-through'
                      : item.source === 'manual'
                        ? 'border-violet-300 bg-violet-50 text-violet-900'
                        : 'border-blue-300 bg-blue-50 text-blue-900';
                    return (
                      <button key={item.id} type="button"
                        aria-label={'פתיחת פרטי תור ' + clockLabel(item.start_at) + ' ' + item.service_name}
                        onClick={() => onSelectAppointment(item.id)}
                        className={'absolute inset-x-1 z-20 overflow-hidden rounded-md border px-1.5 py-1 text-start text-[10px] shadow-sm hover:brightness-95 ' + sourceClass}
                        style={{ top: ((start - bounds.start) / 60) * 64, height: Math.max(24, ((end - start) / 60) * 64) }}>
                        <span className="block truncate font-semibold">{clockLabel(item.start_at)} · {item.service_name}</span>
                        <span className="block truncate">{item.source === 'manual' ? 'תור ידני' : 'נקבע באתר'}{cancelled ? ' · בוטל' : ''}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
