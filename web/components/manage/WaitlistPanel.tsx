'use client';

import { useCallback, useEffect, useState } from 'react';
import { mcall } from '@/lib/manageApi';

type Status = 'waiting' | 'contacted' | 'scheduled' | 'closed' | 'cancelled';
type Entry = {
  id: string;
  customer_name: string;
  customer_phone: string;
  service_ids: string[];
  service_names: string[];
  preferred_date: string;
  preferred_time_from: string | null;
  preferred_time_to: string | null;
  note: string | null;
  status: Status;
  created_at: string;
  updated_at: string;
};
type Response = { total: number; entries: Entry[] };
const labels: Record<Status, string> = {
  waiting: 'ממתין',
  contacted: 'נוצר קשר',
  scheduled: 'נקבע תור',
  closed: 'נסגר',
  cancelled: 'בוטל',
};

export default function WaitlistPanel({ token }: { token: string }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [filter, setFilter] = useState<Status | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const query = filter ? `?status=${filter}` : '';
      const result = await mcall<Response>(token, `waitlist${query}`);
      setEntries(result.entries);
    } catch {
      setError('לא הצלחנו לטעון את רשימת ההמתנה. ודאו שמיגרציית רשימת ההמתנה הותקנה בשרת העסק.');
    } finally {
      setBusy(false);
    }
  }, [token, filter]);

  useEffect(() => { void load(); }, [load]);

  async function updateStatus(entry: Entry, status: Status) {
    setBusy(true); setError(null); setMessage(null);
    try {
      await mcall(token, `waitlist/${entry.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setMessage('סטטוס הבקשה עודכן.');
      await load();
    } catch {
      setError('עדכון הסטטוס נכשל.');
      setBusy(false);
    }
  }

  async function remove(entry: Entry) {
    if (!confirm(`למחוק את בקשת ההמתנה של ${entry.customer_name}?`)) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      await mcall(token, `waitlist/${entry.id}`, { method: 'DELETE' });
      setMessage('בקשת ההמתנה נמחקה.');
      await load();
    } catch {
      setError('מחיקת הבקשה נכשלה.');
      setBusy(false);
    }
  }

  return (
    <section dir="rtl" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">רשימת המתנה</h2>
          <p className="mt-1 text-sm text-gray-600">בקשות המתנה של לקוחות, בנפרד מפניות CRM ומיומן התורים. בקשה אינה שומרת מקום ביומן.</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm">סינון
            <select className="ms-2 min-h-10 rounded-lg border border-gray-300 bg-white px-3" value={filter} onChange={(e) => setFilter(e.target.value as Status | '')}>
              <option value="">כל הסטטוסים</option>
              {(Object.keys(labels) as Status[]).map((status) => <option key={status} value={status}>{labels[status]}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => void load()} disabled={busy} className="min-h-10 rounded-full border border-gray-300 px-4 text-sm">רענון</button>
        </div>
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {message && <p role="status" className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">{message}</p>}
      {busy && !entries.length && <p className="text-sm text-gray-500">טוען…</p>}
      {!busy && !entries.length && <p className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">אין בקשות המתנה להצגה.</p>}
      <div className="space-y-3">
        {entries.map((entry) => (
          <article key={entry.id} className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-semibold">{entry.customer_name}</h3>
                <p className="mt-1 text-sm" dir="ltr">{entry.customer_phone}</p>
                <p className="mt-2 text-sm text-gray-700">שירותים: {entry.service_names.join(', ')}</p>
                <p className="mt-2 text-sm text-gray-700">
                  {new Date(`${entry.preferred_date}T12:00:00`).toLocaleDateString('he-IL')}
                  {entry.preferred_time_from ? ` · ${String(entry.preferred_time_from).slice(0, 5)}–${String(entry.preferred_time_to).slice(0, 5)}` : ' · ללא שעה מועדפת'}
                </p>
                {entry.note && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-gray-600">{entry.note}</p>}
                <p className="mt-2 text-xs text-gray-500">נשלח: {new Date(entry.created_at).toLocaleString('he-IL')}</p>
              </div>
              <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium">{labels[entry.status]}</span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label className="text-xs text-gray-600">עדכון סטטוס
                <select aria-label={`סטטוס עבור ${entry.customer_name}`} disabled={busy} className="ms-2 min-h-9 rounded-lg border border-gray-300 bg-white px-2" value={entry.status} onChange={(e) => void updateStatus(entry, e.target.value as Status)}>
                  {(Object.keys(labels) as Status[]).map((status) => <option key={status} value={status}>{labels[status]}</option>)}
                </select>
              </label>
              <button type="button" disabled={busy} onClick={() => void remove(entry)} className="min-h-9 rounded-full border border-red-200 px-3 text-xs text-red-700">מחיקה</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
