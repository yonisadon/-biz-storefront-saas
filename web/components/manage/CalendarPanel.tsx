'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { mcallWithTimeout } from '@/lib/manageApi';
import CalendarTimeline from '@/components/manage/CalendarTimeline';
import type { ManageBusiness, MProduct, MProductsResponse } from '@/lib/types';
import { usePlatformLanguage } from '@/components/PlatformLanguageProvider';

type Appointment = {
  id: string; lead_id: string | null; service_id: string | null; service_name: string;
  customer_phone: string; start_at: string; end_at: string; source: 'website' | 'manual';
  status: 'reserved' | 'cancelled'; created_at?: string;
};
type TimeBlock = { id: string; start_at: string; end_at: string; reason: string | null; conflicting_appointments?: number };
type CalendarResponse = { date: string; timezone: string; appointments: Appointment[]; blocks: TimeBlock[] };
type OpeningRange = { open: string; close: string };

function dateTimeInTimezone(timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}
function todayInTimezone(timezone: string) {
  return dateTimeInTimezone(timezone).slice(0, 10);
}
function localLabel(value: string) { return value.slice(11, 16); }
function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string) {
  return aStart < bEnd && bStart < aEnd;
}
function slotsFor(date: string, duration: number, ranges: OpeningRange[], appointments: Appointment[], blocks: TimeBlock[], localNow: string) {
  const result: string[] = [];
  const mins = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  for (const range of ranges) {
    const open = mins(range.open), close = mins(range.close);
    if (!Number.isFinite(open) || !Number.isFinite(close) || duration <= 0) continue;
    // Keep seller-side suggestions aligned with the API's fixed 15-minute slot grid.
    for (let m = Math.ceil(open / 15) * 15; m + duration <= close; m += 15) {
      const start = `${date}T${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      const endM = m + duration;
      const end = `${date}T${String(Math.floor(endM / 60)).padStart(2, '0')}:${String(endM % 60).padStart(2, '0')}`;
      if (date === localNow.slice(0, 10) && start <= localNow) continue;
      if (appointments.some((a) => a.status === 'reserved' && overlaps(start, end, a.start_at, a.end_at))) continue;
      if (blocks.some((b) => overlaps(start, end, b.start_at, b.end_at))) continue;
      result.push(start);
    }
  }
  return result;
}

export default function CalendarPanel({ token, biz }: { token: string; biz: ManageBusiness }) {
  const [date, setDate] = useState(() => todayInTimezone(biz.timezone || 'Asia/Jerusalem'));
  const { language, t } = usePlatformLanguage();
  const locale = language === 'he' ? 'he-IL' : language === 'ru' ? 'ru-RU' : 'en-US';
  const [viewMode, setViewMode] = useState<'day' | 'week' | 'month'>('day');
  const [calendar, setCalendar] = useState<CalendarResponse | null>(null);
  const [products, setProducts] = useState<MProduct[]>([]);
  const [serviceId, setServiceId] = useState('');
  const [phone, setPhone] = useState('');
  const [startTime, setStartTime] = useState('');
  const [blockStart, setBlockStart] = useState('12:00');
  const [blockEnd, setBlockEnd] = useState('13:00');
  const [blockReason, setBlockReason] = useState('');
  const [allDayBlock, setAllDayBlock] = useState(false);
  const [editingTimes, setEditingTimes] = useState<Record<string, string>>({});
  const [editingServices, setEditingServices] = useState<Record<string, string>>({});
  const [activeAppointmentId, setActiveAppointmentId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const range = useMemo(() => {
    const d = new Date(date + 'T12:00:00Z');
    if (viewMode === 'day') return { from: date, to: date };
    if (viewMode === 'week') {
      const offset = (d.getUTCDay() + 6) % 7;
      d.setUTCDate(d.getUTCDate() - offset);
      const from = d.toISOString().slice(0, 10);
      d.setUTCDate(d.getUTCDate() + 6);
      return { from, to: d.toISOString().slice(0, 10) };
    }
    d.setUTCDate(1);
    const offset = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - offset);
    const from = d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + 41);
    return { from, to: d.toISOString().slice(0, 10) };
  }, [date, viewMode]);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const query = range.from === range.to ? `appointments?date=${range.from}` : `appointments?from=${range.from}&to=${range.to}`;
      const [cal, list] = await Promise.all([
        mcallWithTimeout<CalendarResponse>(token, query),
        mcallWithTimeout<MProductsResponse>(token, 'products?limit=100&offset=0&status=active'),
      ]);
      setCalendar(cal);
      const services = list.items.filter((p) => p.kind === 'service' && p.is_active);
      setProducts(services);
      setServiceId((current) => services.some((p) => p.id === current) ? current : services[0]?.id ?? '');
    } catch {
      setError(t('calendarLoadFailed'));
    } finally { setBusy(false); }
  }, [token, range.from, range.to]);

  useEffect(() => { void load(); }, [load]);

  const moveDate = (delta: number) => {
    const next = new Date(date + 'T12:00:00Z');
    if (viewMode === 'month') { next.setUTCDate(1); next.setUTCMonth(next.getUTCMonth() + delta); }
    else next.setUTCDate(next.getUTCDate() + delta * (viewMode === 'week' ? 7 : 1));
    setDate(next.toISOString().slice(0, 10));
  };
  const selectedDateLabel = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));

  const service = products.find((p) => p.id === serviceId);
  const selectedAppointments = useMemo(() => (calendar?.appointments ?? []).filter((item) => item.start_at < date + 'T24:00' && item.end_at > date + 'T00:00'), [calendar, date]);
  const selectedBlocks = useMemo(() => (calendar?.blocks ?? []).filter((item) => item.start_at < date + 'T24:00' && item.end_at > date + 'T00:00'), [calendar, date]);

  useEffect(() => {
    if (!activeAppointmentId) return;
    document.getElementById('appointment-details-' + activeAppointmentId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeAppointmentId, date, selectedAppointments]);
  const visibleDates = useMemo(() => {
    if (viewMode === 'day') return [];
    const from = new Date(range.from + 'T12:00:00Z');
    const count = viewMode === 'week' ? 7 : 42;
    return Array.from({ length: count }, (_, index) => { const d = new Date(from); d.setUTCDate(d.getUTCDate() + index); return d.toISOString().slice(0, 10); });
  }, [viewMode, range.from]);
  const timelineDates = useMemo(
    () => viewMode === 'day' ? [date] : viewMode === 'week' ? visibleDates : [],
    [viewMode, date, visibleDates],
  );
  const ranges = useMemo(() => {
    const days = biz.config?.opening_hours?.days;
    if (!days || typeof days !== 'object') return [];
    const weekday = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date(`${date}T12:00:00Z`).getUTCDay()];
    const value = (days as Record<string, unknown>)[weekday];
    return Array.isArray(value) ? value.filter((r): r is OpeningRange => !!r && typeof r === 'object' && typeof (r as OpeningRange).open === 'string' && typeof (r as OpeningRange).close === 'string') : [];
  }, [biz.config, date]);
  const calendarTimezone = calendar?.timezone || biz.timezone || 'Asia/Jerusalem';
  const localNow = dateTimeInTimezone(calendarTimezone);
  const freeSlots = useMemo(() => service && calendar
    ? slotsFor(date, service.appointment_duration_minutes || 30, ranges, selectedAppointments, selectedBlocks, localNow)
    : [], [service, calendar, selectedAppointments, selectedBlocks, date, ranges, localNow]);

  async function createAppointment() {
    if (!serviceId || !phone.trim() || !startTime) return setError(t('selectServicePhoneTime'));
    setBusy(true); setError(null); setMessage(null);
    try {
      await mcallWithTimeout(token, 'appointments', {
        method: 'POST',
        body: JSON.stringify({ service_id: serviceId, customer_phone: phone, start_at: `${date}T${startTime}` }),
      });
      setPhone(''); setStartTime('');
      setMessage(t('appointmentSaved'));
      await load();
    } catch (err) {
      setError(err instanceof Error && err.name === 'AbortError'
        ? t('appointmentDelayed')
        : err instanceof Error && err.message.includes('409')
          ? t('appointmentConflict')
          : t('appointmentSaveFailed'));
    } finally { setBusy(false); }
  }

  async function changeStatus(item: Appointment, status: 'reserved' | 'cancelled') {
    setBusy(true); setError(null); setMessage(null);
    try {
      await mcallWithTimeout(token, `appointments/${item.id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      setMessage(status === 'cancelled' ? t('appointmentCanceled') : t('appointmentRestored'));
      await load();
    } catch { setError(t('updateAppointmentFailed')); }
    finally { setBusy(false); }
  }

  async function saveAppointment(item: Appointment) {
    const start_at = editingTimes[item.id] || undefined;
    const service_id = editingServices[item.id] || item.service_id || undefined;
    if (!start_at && !editingServices[item.id]) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      await mcallWithTimeout(token, `appointments/${item.id}`, { method: 'PATCH', body: JSON.stringify({ ...(start_at ? { start_at } : {}), ...(service_id ? { service_id } : {}) }) });
      setMessage(t('appointmentUpdated'));
      setEditingTimes((v) => { const n = { ...v }; delete n[item.id]; return n; });
      setEditingServices((v) => { const n = { ...v }; delete n[item.id]; return n; });
      await load();
    } catch { setError(t('appointmentUpdateConflict')); }
    finally { setBusy(false); }
  }

  async function deleteAppointment(item: Appointment) {
    if (!confirm(`${t('appointmentDeleteConfirm')} ${item.customer_phone}?`)) return;
    setBusy(true); setError(null);
    try { await mcallWithTimeout(token, `appointments/${item.id}`, { method: 'DELETE' }); setMessage(t('appointmentDeleted')); await load(); }
    catch { setError(t('appointmentDeleteFailed')); }
    finally { setBusy(false); }
  }

  async function createBlock() {
    if (!allDayBlock && (!blockStart || !blockEnd || blockEnd <= blockStart)) return setError(t('blockEndAfterStart'));
    setBusy(true); setError(null); setMessage(null);
    try {
      const nextDateValue = new Date(`${date}T12:00:00Z`);
      nextDateValue.setUTCDate(nextDateValue.getUTCDate() + 1);
      const nextDate = `${nextDateValue.getUTCFullYear()}-${String(nextDateValue.getUTCMonth() + 1).padStart(2, '0')}-${String(nextDateValue.getUTCDate()).padStart(2, '0')}`;
      const result = await mcallWithTimeout<TimeBlock>(token, 'appointment-blocks', {
        method: 'POST',
        body: JSON.stringify({
          start_at: allDayBlock ? `${date}T00:00` : `${date}T${blockStart}`,
          end_at: allDayBlock ? `${nextDate}T00:00` : `${date}T${blockEnd}`,
          reason: blockReason,
        }),
      });
      setMessage(result.conflicting_appointments
        ? `${t('blockSavedConflicts')} (${result.conflicting_appointments})`
        : t('blockSaved'));
      setBlockReason(''); setAllDayBlock(false);
      await load();
    } catch { setError(t('blockSaveFailed')); }
    finally { setBusy(false); }
  }

  async function deleteBlock(block: TimeBlock) {
    setBusy(true); setError(null);
    try { await mcallWithTimeout(token, `appointment-blocks/${block.id}`, { method: 'DELETE' }); setMessage(t('blockRemoved')); await load(); }
    catch { setError(t('blockRemoveFailed')); }
    finally { setBusy(false); }
  }

  const field = 'min-h-10 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm';
  return <section dir={language === "he" ? "rtl" : "ltr"} aria-label={t("tabCalendar")} className="space-y-4">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0"><h2 className="text-lg font-bold">{t('calendarTitle')}</h2><p className="mt-1 text-sm text-gray-600">{t('calendarSubtitle')}</p></div>
      <div className="grid w-full min-w-0 grid-cols-1 gap-2 sm:w-auto sm:min-w-[420px]">
        <div className="flex justify-center rounded-full border bg-gray-50 p-1 sm:justify-start" role="group" aria-label={t("calendarTitle")}>{([['day',t('calendarViewDay')],['week',t('calendarViewWeek')],['month',t('calendarViewMonth')]] as const).map(([mode,label]) => <button key={mode} type="button" aria-pressed={viewMode === mode} onClick={() => setViewMode(mode)} className={`flex-1 rounded-full px-3 py-2 text-sm sm:flex-none ${viewMode === mode ? 'bg-white font-bold shadow-sm' : 'text-gray-600'}`}>{label}</button>)}</div>
        <div className="grid min-w-0 grid-cols-[40px_minmax(0,1fr)_40px] items-center gap-2">
          <button type="button" onClick={() => moveDate(-1)} aria-label={t('previous')} className="grid h-10 w-10 place-items-center rounded-full border border-gray-300 bg-white">‹</button>
          <div className="min-w-0 text-center"><p className="truncate text-sm font-semibold">{viewMode === 'month' ? new Intl.DateTimeFormat(locale,{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(date.slice(0,7)+'-01T12:00:00Z')) : selectedDateLabel}</p><label className="sr-only" htmlFor="seller-calendar-date">{t('selectDate')}</label><input id="seller-calendar-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${field} mt-1 w-full max-w-48`}/></div>
          <button type="button" onClick={() => moveDate(1)} aria-label={t('next')} className="grid h-10 w-10 place-items-center rounded-full border border-gray-300 bg-white">›</button>
        </div>
        <div className="flex items-center gap-2"><button type="button" onClick={() => {setDate(todayInTimezone(calendarTimezone));setViewMode('day');}} className="min-h-10 flex-1 rounded-full border border-gray-300 bg-white px-4 py-2 text-sm font-semibold">{t('today')}</button><button type="button" onClick={() => void load()} disabled={busy} className="min-h-10 flex-1 rounded-full border border-gray-300 bg-white px-4 py-2 text-sm">{t('refresh')}</button></div>
      </div>
    </div>
    {viewMode === 'month' && <div className="rounded-2xl border border-gray-200 bg-white p-3"><div className="mb-2 grid grid-cols-7 gap-1 text-center text-xs font-semibold text-gray-500">{[t('weekdayMon'),t('weekdayTue'),t('weekdayWed'),t('weekdayThu'),t('weekdayFri'),t('weekdaySat'),t('weekdaySun')].map((x) => <span key={x}>{x}</span>)}</div><div className="grid grid-cols-7 gap-1">{visibleDates.map((day) => { const events = (calendar?.appointments ?? []).filter((a) => a.start_at.slice(0,10) === day && a.status === 'reserved'); return <button key={day} type="button" onClick={() => {setDate(day);setViewMode('day');}} aria-pressed={date === day} className={`min-h-16 rounded-xl border p-1 text-center ${date === day ? 'border-gray-900 bg-primary text-primary-fg' : 'border-gray-100 bg-white'}`}><span className="text-sm font-semibold">{Number(day.slice(8,10))}</span><span className={`mt-1 block text-[10px] ${date === day ? 'text-primary-fg/75' : 'text-gray-500'}`}>{events.length ? `${events.length} ${t('appointmentsCount')}` : '—'}</span>{events.slice(0,2).map((event) => <span key={event.id} className={`mt-1 block truncate rounded px-1 text-[9px] ${date === day ? 'bg-white/15' : 'bg-blue-50 text-blue-800'}`}>{localLabel(event.start_at)} {event.service_name}</span>)}</button>;})}</div></div>}
    {timelineDates.length > 0 && (
      <CalendarTimeline
        mode={viewMode === 'week' ? 'week' : 'day'}
        dates={timelineDates}
        selectedDate={date}
        appointments={calendar?.appointments ?? []}
        blocks={calendar?.blocks ?? []}
        openingDays={biz.config?.opening_hours?.days as Record<string, unknown> | null}
        onSelectDate={(day) => { setDate(day); setViewMode('day'); }}
        onSelectAppointment={(id, day) => {
          setDate(day);
          setViewMode('day');
          setActiveAppointmentId(id);
        }}
      />
    )}
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {message && <p role="status" className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">{message}</p>}
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-2xl border border-gray-200 bg-white p-4">
        <h3 className="font-bold">{t('manualAppointment')}</h3>
        <p className="mt-1 text-xs text-gray-500">{t('manualAppointmentHint')}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">{t('serviceLabel')}<select className={`${field} mt-1 w-full`} value={serviceId} onChange={(e) => { setServiceId(e.target.value); setStartTime(''); }}><option value="">{t('chooseService')}</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.appointment_duration_minutes} {t('minutesAbbr')}</option>)}</select></label>
          <label className="text-sm">{t('customerPhone')}<input className={`${field} mt-1 w-full`} dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="05X-XXXXXXX"/></label>
        </div>
        <div className="mt-3"><p className="text-sm font-medium">{t('availableHours')}</p>
          {!service && <p className="mt-2 text-sm text-gray-500">{t('chooseServiceHint')}</p>}
          {service && !freeSlots.length && <p className="mt-2 text-sm text-gray-500">{t('noAvailableHours')}</p>}
          <div className="mt-2 flex flex-wrap gap-2">{freeSlots.map((slot) => <button type="button" key={slot} onClick={() => setStartTime(localLabel(slot))} className={`rounded-full px-3 py-2 text-sm ring-1 ${startTime === localLabel(slot) ? 'bg-primary text-primary-fg ring-gray-900' : 'bg-white ring-gray-300'}`}>{localLabel(slot)}</button>)}</div>
        </div>
        <button type="button" onClick={() => void createAppointment()} disabled={busy || !service || !phone.trim() || !startTime} className="mt-4 min-h-11 w-full rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-fg disabled:opacity-50">{t('saveAppointment')}</button>
      </div>
      <div className="rounded-2xl border border-gray-200 bg-white p-4">
        <h3 className="font-bold">{t('timeBlock')}</h3><p className="mt-1 text-xs text-gray-500">{t('timeBlockHint')}</p>
        <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={allDayBlock} onChange={(e) => setAllDayBlock(e.target.checked)}/> {t('fullDayBlock')}</label>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="text-sm">{t('fromTime')}<input type="time" disabled={allDayBlock} className={`${field} mt-1 w-full disabled:opacity-50`} value={blockStart} onChange={(e) => setBlockStart(e.target.value)}/></label>
          <label className="text-sm">{t('untilTime')}<input type="time" disabled={allDayBlock} className={`${field} mt-1 w-full disabled:opacity-50`} value={blockEnd} onChange={(e) => setBlockEnd(e.target.value)}/></label>
        </div>
        <label className="mt-3 block text-sm">{t('reasonOptional')}<input className={`${field} mt-1 w-full`} value={blockReason} onChange={(e) => setBlockReason(e.target.value)} maxLength={300} placeholder={t('reasonExample')}/></label>
        <button type="button" onClick={() => void createBlock()} disabled={busy} className="mt-3 min-h-11 w-full rounded-full border border-gray-300 bg-white px-4 py-2 text-sm font-semibold">{t('saveBlock')}</button>
      </div>
    </div>
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <h3 className="font-bold">{t('appointmentsForDate')}</h3>
      {busy && !calendar && <p className="mt-3 text-sm text-gray-500">{t('loading')}</p>}
      {!selectedAppointments.length && <p className="mt-3 text-sm text-gray-500">{t('noAppointmentsForDate')}</p>}
      <div className="mt-3 space-y-3">{selectedAppointments.map((item) => <div id={'appointment-details-' + item.id} key={item.id} className={'rounded-xl border p-3 ' + (activeAppointmentId === item.id ? 'border-primary ring-2 ring-primary/20' : 'border-gray-200')}>
        <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-semibold">{localLabel(item.start_at)}–{localLabel(item.end_at)} · {item.service_name}</p><p className="mt-1 text-sm text-gray-600" dir="ltr">{item.customer_phone} · {item.source === 'manual' ? t('manualAppointmentTag') : t('fromWebsite')}</p><p className="mt-1 text-xs text-gray-500">{item.status === 'reserved' ? t('reserved') : t('canceledStatus')}</p></div>
          <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => void changeStatus(item, item.status === 'reserved' ? 'cancelled' : 'reserved')} className="rounded-full border border-gray-300 px-3 py-1.5 text-xs">{item.status === 'reserved' ? t('cancelRelease') : t('restoreToCalendar')}</button><button type="button" disabled={busy} onClick={() => void deleteAppointment(item)} className="rounded-full border border-red-200 px-3 py-1.5 text-xs text-red-700">{t('delete')}</button></div>
        </div>
        {item.status === 'reserved' && <div className="mt-3 flex flex-wrap gap-2">
          <label className="text-xs text-gray-600">{t('serviceLabel')}<select aria-label={t('newService')} className={field} value={editingServices[item.id] ?? item.service_id ?? ''} onChange={(e) => setEditingServices((v) => ({ ...v, [item.id]: e.target.value }))}><option value="">{t('serviceUnavailable')}</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.appointment_duration_minutes} {t('minutesAbbr')}</option>)}</select></label>
          <label className="text-xs text-gray-600">{t('newDateTime')}<input type="datetime-local" aria-label={t('newDateTime')} className={field} value={editingTimes[item.id] ?? ''} onChange={(e) => setEditingTimes((v) => ({ ...v, [item.id]: e.target.value }))}/></label>
          <button type="button" disabled={busy || (!editingTimes[item.id] && !editingServices[item.id])} onClick={() => void saveAppointment(item)} className="self-end rounded-full bg-primary px-3 py-2 text-xs font-semibold text-primary-fg disabled:opacity-50">{t('saveChanges')}</button>
        </div>}
      </div>)}</div>
    </div>
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <h3 className="font-bold">{t('blocksForDate')}</h3>
      {!selectedBlocks.length && <p className="mt-2 text-sm text-gray-500">{t('noBlocks')}</p>}
      <div className="mt-2 space-y-2">{selectedBlocks.map((block) => <div key={block.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-gray-50 p-3 text-sm"><span>{localLabel(block.start_at)}–{localLabel(block.end_at)}{block.reason ? ` · ${block.reason}` : ''}</span><button type="button" disabled={busy} onClick={() => void deleteBlock(block)} className="text-red-700 underline">{t('removeBlock')}</button></div>)}</div>
    </div>
  </section>;
}
