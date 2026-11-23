'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type BusinessEntitlement = {
  id: string;
  name: string;
  slug: string;
  status: string;
  push_enabled: boolean;
  updated_at: string | null;
};

export default function ChannelEntitlementsPage() {
  const [businesses, setBusinesses] = useState<BusinessEntitlement[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/admin/channel-entitlements', { cache: 'no-store', credentials: 'same-origin' });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.message ?? 'לא ניתן לטעון את הרשאות הערוצים.');
      setBusinesses((data?.businesses ?? []) as BusinessEntitlement[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'טעינת הרשאות הערוצים נכשלה.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function setPush(business: BusinessEntitlement, enabled: boolean) {
    setSavingId(business.id);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/admin/businesses/' + business.id + '/channel-entitlements', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ channel: 'push', enabled }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.message ?? 'עדכון הרשאת Push נכשל.');
      setBusinesses((current) => current.map((item) => item.id === business.id ? { ...item, push_enabled: enabled } : item));
      setMessage('הרשאת Push עודכנה עבור ' + business.name + '.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'עדכון הרשאת Push נכשל.');
    } finally {
      setSavingId(null);
    }
  }

  return (
    <main dir="rtl" className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 sm:px-6">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-blue-700">ניהול פלטפורמה</p>
            <h1 className="mt-1 text-2xl font-bold">הרשאות ערוצי התראות</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">כאן מנהל-העל קובע אילו עסקים רשאים להשתמש בכל ערוץ. הרשאת Push נפרדת מההעדפות שהמוכר מגדיר באזור הניהול.</p>
          </div>
          <Link href="/platform-admin" className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold">חזרה לניהול הפלטפורמה</Link>
        </div>

        <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <h2 className="font-bold">ערוצים זמינים</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <div className="rounded-xl bg-blue-50 p-3">
              <p className="font-semibold text-blue-900">Push</p>
              <p className="mt-1 text-xs leading-5 text-blue-900/75">זמין בשלב הראשון. ניתן להפעיל או לחסום לכל עסק בנפרד.</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="font-semibold">WhatsApp</p>
              <p className="mt-1 text-xs leading-5 text-slate-600">ערוץ עתידי — לא מופעל ולא נשלחות הודעות בשלב זה.</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="font-semibold">SMS</p>
              <p className="mt-1 text-xs leading-5 text-slate-600">ערוץ עתידי — לא מופעל ולא נשלחות הודעות בשלב זה.</p>
            </div>
          </div>
        </section>

        {error && <p role="alert" className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        {message && <p role="status" className="mb-3 rounded-xl bg-green-50 p-3 text-sm text-green-900">{message}</p>}
        {loading ? <p role="status" className="rounded-xl bg-white p-5 text-sm text-slate-600">טוען עסקים…</p> : (
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-bold">עסקים ({businesses.length})</h2>
              <button type="button" onClick={() => void load()} className="text-sm font-semibold text-blue-700 underline">רענון</button>
            </div>
            {businesses.map((business) => (
              <article key={business.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
                <div className="min-w-0">
                  <p className="font-semibold">{business.name}</p>
                  <p className="mt-1 text-xs text-slate-500" dir="ltr">/{business.slug} · {business.status}</p>
                </div>
                <label className="flex items-center gap-3 text-sm font-semibold">
                  <span>{business.push_enabled ? 'Push מאושר' : 'Push חסום'}</span>
                  <input type="checkbox" checked={business.push_enabled} disabled={savingId === business.id}
                    onChange={(event) => void setPush(business, event.target.checked)}
                    className="h-5 w-5 accent-blue-700" />
                </label>
              </article>
            ))}
            {businesses.length === 0 && <p className="rounded-xl bg-white p-5 text-sm text-slate-600">לא נמצאו עסקים.</p>}
          </section>
        )}
      </div>
    </main>
  );
}
