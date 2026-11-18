'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';

type Mode = 'register' | 'login';

export default function AccountAuthForm({ mode }: { mode: Mode }) {
  const isRegister = mode === 'register';
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage('');
    setError('');
    try {
      const response = await fetch(`/api/auth/${isRegister ? 'register' : 'login'}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, ...(isRegister ? { phone } : {}) }),
        cache: 'no-store',
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const messages: Record<string, string> = {
          invalid_credentials: 'כתובת המייל או הסיסמה אינם נכונים.',
          email_not_verified: 'כתובת המייל עדיין לא אומתה. אפשר לשלוח קישור אימות חדש.',
          email_service_not_configured: 'שירות שליחת המיילים עדיין לא הוגדר. אפשר לפנות לתמיכה.',
          invalid_il_phone: 'יש להזין מספר טלפון ישראלי תקין.',
          account_service_not_configured: 'שירות החשבונות עדיין לא הוגדר.',
        };
        throw new Error(messages[data?.error] ?? data?.message ?? 'לא ניתן להשלים את הפעולה כרגע.');
      }
      if (isRegister) {
        setMessage(data?.message ?? 'אם פרטי ההרשמה תקינים, נשלח אליך מייל לאימות הכתובת.');
      } else {
        window.location.assign(data?.role === 'super_admin' ? '/platform-admin' : '/account');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'אירעה שגיאה.');
    } finally {
      setLoading(false);
    }
  }

  async function resendVerification() {
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
        cache: 'no-store',
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error('לא ניתן לשלוח קישור חדש כרגע.');
      setMessage(data?.message ?? 'אם קיים חשבון שממתין לאימות, יישלח אליו קישור חדש.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'אירעה שגיאה.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main dir="rtl" className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 text-slate-900">
      <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <Link href="/" className="text-sm font-semibold text-blue-700">BTime</Link>
        <h1 className="mt-5 text-2xl font-bold">{isRegister ? 'פתיחת חשבון עסקי' : 'התחברות ל-BTime'}</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          {isRegister ? 'נרשמים, מאמתים את המייל ומקימים את העסק. תקופת הניסיון היא 30 יום.' : 'התחברו כדי לנהל את העסק או להמשיך בהקמתו.'}
        </p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="account-email" className="mb-1.5 block text-sm font-semibold">כתובת מייל</label>
            <input id="account-email" type="email" required maxLength={254} autoComplete="email" value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-3 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" dir="ltr" />
          </div>
          {isRegister && <div>
            <label htmlFor="account-phone" className="mb-1.5 block text-sm font-semibold">מספר טלפון</label>
            <input id="account-phone" type="tel" required autoComplete="tel" value={phone}
              onChange={(event) => setPhone(event.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-3 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" dir="ltr" placeholder="05X-XXXXXXX" />
            <p className="mt-1 text-xs text-slate-500">המספר משמש לזיהוי החשבון ולמניעת פתיחת עסק כפול.</p>
          </div>}
          <div>
            <label htmlFor="account-password" className="mb-1.5 block text-sm font-semibold">סיסמה</label>
            <input id="account-password" type="password" required minLength={isRegister ? 10 : 1} maxLength={128}
              autoComplete={isRegister ? 'new-password' : 'current-password'} value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-3 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" />
            {isRegister && <p className="mt-1 text-xs text-slate-500">לפחות 10 תווים.</p>}
          </div>
          {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
          {message && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">{message}</p>}
          <button type="submit" disabled={loading} className="w-full rounded-xl bg-slate-900 px-4 py-3 font-semibold text-white disabled:opacity-60">
            {loading ? 'רק רגע…' : isRegister ? 'יצירת חשבון ושליחת מייל אימות' : 'התחברות'}
          </button>
          {!isRegister && error.includes('לא אומתה') && <button type="button" disabled={loading || !email}
            onClick={resendVerification} className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold disabled:opacity-50">שליחת קישור אימות חדש</button>}
        </form>
        <div className="mt-5 flex flex-wrap justify-between gap-3 text-sm">
          {isRegister ? <Link href="/login" className="font-semibold text-blue-700">כבר יש לך חשבון? התחברות</Link> : <>
            <Link href="/register" className="font-semibold text-blue-700">פתיחת חשבון חדש</Link>
            <Link href="/forgot-password" className="text-slate-600 underline">שכחתי סיסמה</Link>
          </>}
        </div>
      </section>
    </main>
  );
}
