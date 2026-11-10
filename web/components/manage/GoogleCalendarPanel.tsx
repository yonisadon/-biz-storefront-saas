'use client';

import { useCallback, useEffect, useState } from 'react';
import { mcall } from '@/lib/manageApi';

type Status = {
  configured: boolean;
  connected: boolean;
  google_email: string | null;
  connected_at: string | null;
  last_sync_at: string | null;
  last_error: string | null;
  pending: number;
  failed: number;
};

export default function GoogleCalendarPanel({ token }: { token: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const current = await mcall<Status>(token, 'google-calendar/status');
      setStatus(current);
      if (current.configured && current.connected && current.pending > 0) {
        try {
          await mcall(token, 'google-calendar/sync', { method: 'POST' });
          setStatus(await mcall<Status>(token, 'google-calendar/status'));
        } catch {
          setError('חלק מהאירועים ממתינים לסנכרון. אפשר לנסות שוב באופן ידני.');
        }
      }
    } catch {
      setError('לא הצלחנו לטעון את מצב Google Calendar. ייתכן שהמיגרציה עדיין לא הותקנה בשרת העסק.');
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  async function connect() {
    setBusy(true); setError(null);
    try {
      const result = await mcall<{ authorization_url: string }>(token, 'google-calendar/connect', { method: 'POST' });
      window.location.assign(result.authorization_url);
    } catch {
      setError('לא ניתן להתחיל חיבור ל-Google Calendar. בדקו שהוגדרו פרטי OAuth בשרת.');
      setBusy(false);
    }
  }

  async function sync() {
    setBusy(true); setError(null); setMessage(null);
    try {
      const result = await mcall<{ processed: number; failed: number; pending: number }>(token, 'google-calendar/sync', { method: 'POST' });
      setMessage(`הסנכרון הסתיים: ${result.processed} אירועים עודכנו, ${result.failed} נכשלו, ${result.pending} ממתינים.`);
      await load();
    } catch {
      setError('הסנכרון נכשל. התורים ב-BTime נשארים שמורים; אפשר לנסות שוב.');
    } finally { setBusy(false); }
  }

  async function disconnect() {
    if (!confirm('לנתק את Google Calendar? אירועים שכבר נוצרו ביומן Google יישארו שם ולא יימחקו.')) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      await mcall(token, 'google-calendar/disconnect', { method: 'POST' });
      setMessage('החיבור נותק וההרשאה בוטלה ככל שפרטי OAuth זמינים. אירועים קיימים נשארים ביומן Google.');
      await load();
    } catch {
      setError('ניתוק Google Calendar נכשל. החיבור נשאר פעיל.');
    } finally { setBusy(false); }
  }

  return (
    <section dir="rtl" className="mb-4 rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-bold">סנכרון ל-Google Calendar</h2>
          <p className="mt-1 text-sm text-gray-600">סנכרון חד-כיווני: תורים ב-BTime יוצרים ומעדכנים אירועים ביומן Google. יומן Google אינו משנה את הזמינות ב-BTime.</p>
        </div>
        {status?.connected && <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-semibold text-green-800">מחובר</span>}
      </div>
      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {message && <p role="status" className="mt-3 rounded-lg bg-blue-50 p-3 text-sm text-blue-900">{message}</p>}
      {!status && !error && <p className="mt-3 text-sm text-gray-500">טוען מצב חיבור…</p>}
      {status && !status.configured && (
        <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          החיבור עדיין לא הוגדר בשרת. נדרשים פרטי Google OAuth ומפתח הצפנה לפני שבעלי עסקים יוכלו להתחבר.
        </p>
      )}
      {status?.configured && !status.connected && (
        <div className="mt-3">
          <p className="text-sm text-gray-600">לא מחובר חשבון Google. החיבור אופציונלי ומתבצע בהרשאת בעל העסק.</p>
          <button type="button" disabled={busy} onClick={() => void connect()} className="mt-3 min-h-10 rounded-full bg-gray-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? 'פותחים חיבור…' : 'חיבור חשבון Google'}
          </button>
        </div>
      )}
      {status?.connected && (
        <div className="mt-3 space-y-2">
          <p className="text-sm"><span className="font-semibold">חשבון:</span> <span dir="ltr">{status.google_email}</span></p>
          <p className="text-sm text-gray-600">ממתינים: {status.pending} · נכשלו: {status.failed}</p>
          {status.last_sync_at && <p className="text-xs text-gray-500">סנכרון אחרון: {new Date(status.last_sync_at).toLocaleString('he-IL')}</p>}
          {status.last_error && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">שגיאת סנכרון אחרונה: {status.last_error}</p>}
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" disabled={busy} onClick={() => void sync()} className="min-h-10 rounded-full bg-gray-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {busy ? 'מסנכרנים…' : 'סנכרון עכשיו / ניסיון חוזר'}
            </button>
            <button type="button" disabled={busy} onClick={() => void disconnect()} className="min-h-10 rounded-full border border-gray-300 px-4 py-2 text-sm">
              ניתוק חשבון
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
