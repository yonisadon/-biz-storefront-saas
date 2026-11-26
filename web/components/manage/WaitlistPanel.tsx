'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, mcallWithTimeout } from '@/lib/manageApi';
import { usePlatformLanguage } from '@/components/PlatformLanguageProvider';

type Status = 'waiting' | 'rejected' | 'closed' | 'scheduled_without_booking';
type Entry = {
  id: string;
  customer_name: string | null;
  customer_phone: string;
  service_ids: string[];
  service_names: string[];
  preferred_date: string;
  preferred_time: string | null;
  note: string | null;
  status: Status;
  created_at: string;
  updated_at: string;
  appointment_id: string | null;
  appointment_start_at: string | null;
};
type Response = { total: number; limit: number; offset: number; entries: Entry[]; timezone: string };
const PAGE_SIZE = 50;
const statusTranslationKeys: Record<Status, import('@/lib/platformI18n').PlatformMessageKey> = {
  waiting: 'statusWaiting', rejected: 'statusRejected', closed: 'statusClosed', scheduled_without_booking: 'statusScheduledNoBooking',
};

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

function formatPreferredDate(value: string, locale: string, unavailable: string): string {
  // PostgreSQL DATE may arrive as YYYY-MM-DD or as an ISO timestamp,
  // depending on the driver/serialization path. Keep the calendar day stable.
  const dateOnly = value.slice(0, 10);
  const parsed = dateOnly ? new Date(`${dateOnly}T12:00:00Z`) : new Date(value);
  if (!Number.isFinite(parsed.getTime())) return unavailable;
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC' }).format(parsed);
}

export default function WaitlistPanel({ token }: { token: string }) {
  const { language, t } = usePlatformLanguage();
  const locale = language === 'he' ? 'he-IL' : language === 'ru' ? 'ru-RU' : 'en-US';
  const labels: Record<Status, string> = { waiting: t('statusWaiting'), rejected: t('statusRejected'), closed: t('statusClosed'), scheduled_without_booking: t('statusScheduledNoBooking') };
  const [entries, setEntries] = useState<Entry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState<Status | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [scheduleTimes, setScheduleTimes] = useState<Record<string, string>>({});
  const [businessTimezone, setBusinessTimezone] = useState('Asia/Jerusalem');
  const minimumScheduleDateTime = dateTimeInTimezone(businessTimezone);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
      if (filter) params.set('status', filter);
      const result = await mcallWithTimeout<Response>(token, `waitlist?${params.toString()}`);
      setEntries(result.entries);
      setTotal(result.total);
      if (result.timezone) setBusinessTimezone(result.timezone);
    } catch {
      setError(t('waitlistLoadFailed'));
    } finally {
      setBusy(false);
    }
  }, [token, filter, page, t]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
    if (page > lastPage) setPage(lastPage);
  }, [page, total]);

  async function updateStatus(entry: Entry, status: Status) {
    setBusy(true); setError(null); setMessage(null);
    try {
      await mcallWithTimeout(token, `waitlist/${entry.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setMessage(t('statusUpdated'));
      await load();
    } catch {
      setError(t('waitlistStatusFailed'));
      setBusy(false);
    }
  }

  async function schedule(entry: Entry) {
    const start_at = scheduleTimes[entry.id];
    if (!start_at) { setError(t('chooseAppointmentDateTime')); return; }
    setBusy(true); setError(null); setMessage(null);
    try {
      await mcallWithTimeout(
        token,
        'waitlist/' + entry.id + '/schedule',
        { method: 'POST', body: JSON.stringify({ start_at }) },
      );
      setMessage(t('waitlistAppointmentCreated'));
      setScheduleTimes((current) => { const next = { ...current }; delete next[entry.id]; return next; });
      await load();
    } catch (err) {
      const errorCode = err instanceof ApiError ? err.body?.error : null;
      setError(err instanceof Error && err.name === 'AbortError'
        ? t('waitlistScheduleDelayed')
        : errorCode === 'invalid_appointment_time'
          ? t('appointmentPast')
          : errorCode === 'slot_taken' || (err instanceof ApiError && err.status === 409)
            ? t('slotTaken')
            : err instanceof ApiError && err.status === 400
              ? t('invalidAppointmentTime')
              : t('waitlistScheduleFailed'));
      setBusy(false);
    }
  }

  async function remove(entry: Entry) {
    if (!confirm(`${t('deleteWaitlistConfirm')} (${entry.customer_name || entry.customer_phone})`)) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      await mcallWithTimeout(token, `waitlist/${entry.id}`, { method: 'DELETE' });
      setMessage(t('waitlistDeleted'));
      if (entries.length === 1 && page > 0) setPage((current) => current - 1);
      else await load();
    } catch {
      setError(t('waitlistDeleteFailed'));
      setBusy(false);
    }
  }

  return (
    <section dir={language === "he" ? "rtl" : "ltr"} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">{t('waitlistTitle')}</h2>
          <p className="mt-1 text-sm text-gray-600">{t('waitlistSubtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm">{t('filter')}
            <select className="ms-2 min-h-10 rounded-lg border border-gray-300 bg-white px-3" value={filter} onChange={(e) => { setFilter(e.target.value as Status | ''); setPage(0); }}>
              <option value="">{t('allStatuses')}</option>
              {(Object.keys(labels) as Status[]).map((status) => <option key={status} value={status}>{labels[status]}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => void load()} disabled={busy} className="min-h-10 rounded-full border border-gray-300 px-4 text-sm">{t('refresh')}</button>
        </div>
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {message && <p role="status" className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">{message}</p>}
      {busy && !entries.length && <p className="text-sm text-gray-500">{t('loading')}</p>}
      {!busy && !entries.length && <p className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">{t('noWaitlist')}</p>}
      {total > 0 && <p className="text-xs text-gray-500">{t('shown')} {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} {t('of')} {total} {t('requests')}</p>}
      <div className="space-y-3">
        {entries.map((entry) => (
          <article key={entry.id} className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-semibold">{entry.customer_name || t('noName')}</h3>
                <p className="mt-1 text-sm" dir="ltr">{entry.customer_phone}</p>
                <p className="mt-2 text-sm text-gray-700">{t('services')}: {entry.service_names.join(', ')}</p>
                <p className="mt-2 text-sm text-gray-700">
                  {formatPreferredDate(entry.preferred_date, locale, t('dateUnavailable'))}
                  {entry.preferred_time ? ` · ${String(entry.preferred_time).slice(0, 5)}` : ' · '+t('noPreferredTime')}
                </p>
                {entry.note && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-gray-600">{entry.note}</p>}
                <p className="mt-2 text-xs text-gray-500">{t('sent')}: {new Date(entry.created_at).toLocaleString(locale)}</p>
              </div>
              <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium">{labels[entry.status]}</span>
            </div>
            {entry.appointment_id && (
              <p className="mt-3 rounded-lg bg-emerald-50 p-2 text-sm text-emerald-900">
                {t('linkedAppointment')}{entry.appointment_start_at ? ': ' + new Date(entry.appointment_start_at).toLocaleString(locale) : ' ('+t('appointmentRecordMissing')+')'}.
                {t('changeAppointmentInCalendar')}
              </p>
            )}
            {entry.status === 'waiting' && (
              <div className="mt-3 flex flex-wrap items-end gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
                <label className="min-w-[220px] flex-1 text-xs text-gray-600">{t('appointmentDateInCalendar')}
                  <input type="datetime-local" step={60} min={minimumScheduleDateTime} value={scheduleTimes[entry.id] ?? ''} onChange={(e) => setScheduleTimes((current) => ({ ...current, [entry.id]: e.target.value }))} disabled={busy} className="mt-1 min-h-10 w-full rounded-lg border border-gray-300 bg-white px-2 text-sm" />
                </label>
                <button type="button" disabled={busy || !scheduleTimes[entry.id]} onClick={() => void schedule(entry)} className="min-h-10 rounded-full bg-gray-900 px-4 text-sm font-semibold text-white disabled:opacity-50">{t('scheduleInCalendar')}</button>
              </div>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label className="text-xs text-gray-600">{t('updateStatus')}
                <select aria-label={'סטטוס עבור ' + (entry.customer_name || entry.customer_phone)} disabled={busy || entry.status === 'closed' || Boolean(entry.appointment_id)} className="ms-2 min-h-9 rounded-lg border border-gray-300 bg-white px-2" value={entry.status} onChange={(e) => void updateStatus(entry, e.target.value as Status)}>
                  {(Object.keys(labels) as Status[]).map((status) => <option key={status} value={status} disabled={status === 'closed'}>{labels[status]}</option>)}
                </select>
              </label>
              <button type="button" disabled={busy} onClick={() => void remove(entry)} className="min-h-9 rounded-full border border-red-200 px-3 text-xs text-red-700">מחיקה</button>
            </div>
          </article>
        ))}
      </div>
      {total > PAGE_SIZE && <nav aria-label={t('waitlistPages')} className="flex flex-wrap items-center justify-center gap-3 pt-2">
        <button type="button" disabled={busy || page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))} className="min-h-10 rounded-full border border-gray-300 px-4 text-sm disabled:opacity-40">{t('previousPage')}</button>
        <span className="text-sm text-gray-600">{t('page')} {page + 1} {t('of')} {Math.ceil(total / PAGE_SIZE)}</span>
        <button type="button" disabled={busy || (page + 1) * PAGE_SIZE >= total} onClick={() => setPage((current) => current + 1)} className="min-h-10 rounded-full border border-gray-300 px-4 text-sm disabled:opacity-40">{t('nextPage')}</button>
      </nav>}
    </section>
  );
}
