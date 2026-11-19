'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function VerifyEmailClient({ token }: { token: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function verify() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/auth/verify-email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
        cache: 'no-store',
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error('קישור האימות אינו תקף או שפג תוקפו. אפשר לבקש קישור חדש.');
      setDone(true);
      window.location.assign('/account');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'לא ניתן לאמת את כתובת המייל.');
    } finally {
      setLoading(false);
    }
  }

  return <main dir="rtl" className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 text-slate-900">
    <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-7 text-center shadow-sm">
      <p className="text-sm font-semibold text-blue-700">BTime</p>
      <h1 className="mt-4 text-2xl font-bold">אימות כתובת המייל</h1>
      {done ? <p className="mt-3 text-sm text-slate-600">כתובת הדוא״ל אומתה בהצלחה. מעבירים אותך לחשבון שלך…</p> : <>
        <p className="mt-3 text-sm leading-6 text-slate-600">לחצו על הכפתור כדי לאמת את כתובת הדוא״ל. לאחר האימות תוכלו להמשיך לחשבון ולהקים את העסק.</p>
        {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        <button type="button" disabled={loading || !token} onClick={verify}
          className="mt-5 w-full rounded-xl bg-slate-900 px-4 py-3 font-semibold text-white disabled:opacity-50">
          {loading ? 'מאמת…' : 'אימות כתובת המייל'}
        </button>
      </>}
      {!token && <p className="mt-4 text-sm text-red-700">לא נמצא קישור אימות תקין.</p>}
      <Link href="/login" className="mt-5 inline-block text-sm font-semibold text-blue-700">חזרה להתחברות</Link>
    </section>
  </main>;
}
