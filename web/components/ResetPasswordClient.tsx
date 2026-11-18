'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';

export default function ResetPasswordClient({ token }: { token: string }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    if (password !== confirm) { setError('הסיסמאות אינן תואמות.'); return; }
    setLoading(true);
    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, password }),
        cache: 'no-store',
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error('קישור האיפוס אינו תקף או שפג תוקפו. בקשו קישור חדש.');
      setMessage(data?.message ?? 'הסיסמה עודכנה בהצלחה.');
      setPassword('');
      setConfirm('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'לא ניתן לעדכן את הסיסמה.');
    } finally {
      setLoading(false);
    }
  }

  return <main dir="rtl" className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 text-slate-900">
    <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
      <p className="text-sm font-semibold text-blue-700">BTime</p>
      <h1 className="mt-4 text-2xl font-bold">בחירת סיסמה חדשה</h1>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <div><label htmlFor="new-password" className="mb-1.5 block text-sm font-semibold">סיסמה חדשה</label>
          <input id="new-password" type="password" minLength={10} maxLength={128} required autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3 py-3" /></div>
        <div><label htmlFor="confirm-password" className="mb-1.5 block text-sm font-semibold">אימות סיסמה</label>
          <input id="confirm-password" type="password" minLength={10} maxLength={128} required autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3 py-3" /></div>
        {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        {message && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">{message}</p>}
        <button type="submit" disabled={loading || !token} className="w-full rounded-xl bg-slate-900 px-4 py-3 font-semibold text-white disabled:opacity-50">{loading ? 'מעדכן…' : 'עדכון סיסמה'}</button>
      </form>
      <Link href="/login" className="mt-5 inline-block text-sm font-semibold text-blue-700">חזרה להתחברות</Link>
    </section>
  </main>;
}
