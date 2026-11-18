'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';

type Mode = 'register' | 'login';

function PasswordField({ id, label, value, onChange, autoComplete, minLength = 1 }: {
  id: string; label: string; value: string; onChange: (value: string) => void;
  autoComplete: string; minLength?: number;
}) {
  const [visible, setVisible] = useState(false);
  return <div>
    <label htmlFor={id} className="mb-1.5 block text-sm font-semibold">{label}</label>
    <div className="relative">
      <input id={id} type={visible ? 'text' : 'password'} required minLength={minLength} maxLength={128}
        autoComplete={autoComplete} value={value} onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-slate-300 px-3 py-3 pl-12 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" dir="ltr" />
      <button type="button" onClick={() => setVisible((current) => !current)}
        aria-label={visible ? 'הסתרת סיסמה' : 'הצגת סיסמה'} aria-pressed={visible}
        className="absolute left-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500">
        {visible ? <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8"/><path d="M9.9 5.2A10.8 10.8 0 0112 5c5 0 8.5 4.5 9.5 7-.4 1-1.3 2.3-2.6 3.5M6.2 6.2C3.8 7.7 2.5 10.1 2.5 12c1 2.5 4.5 7 9.5 7 1.3 0 2.5-.3 3.6-.8"/></svg>
          : <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z"/><circle cx="12" cy="12" r="3"/></svg>}
      </button>
    </div>
  </div>;
}

export default function AccountAuthForm({ mode }: { mode: Mode }) {
  const isRegister = mode === 'register';
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [marketingEmail, setMarketingEmail] = useState(false);
  const [marketingSms, setMarketingSms] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    setError('');
    if (isRegister && password !== confirmPassword) { setError('הסיסמאות אינן תואמות.'); return; }
    setLoading(true);
    try {
      const response = await fetch(`/api/auth/${isRegister ? 'register' : 'login'}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, ...(isRegister ? { phone, termsAccepted: legalAccepted, privacyAccepted: legalAccepted, marketingEmail, marketingSms } : {}) }),
        cache: 'no-store',
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const messages: Record<string, string> = {
          invalid_credentials: 'כתובת המייל או הסיסמה אינם נכונים.',
          email_not_verified: 'כתובת המייל עדיין לא אומתה. אפשר לשלוח קישור אימות חדש.',
          email_service_not_configured: 'שירות שליחת המיילים עדיין לא הוגדר. אפשר לפנות לתמיכה.',
          invalid_phone: 'יש להזין מספר טלפון תקין בפורמט בינלאומי, כולל קידומת מדינה.',
          account_service_not_configured: 'שירות החשבונות עדיין לא הוגדר.',
        };
        throw new Error(messages[data?.error] ?? data?.message ?? 'לא ניתן להשלים את הפעולה כרגע.');
      }
      if (isRegister) {
        setMessage(data?.message ?? 'בקשת ההרשמה התקבלה. אם כתובת המייל זמינה לפתיחת חשבון, יישלח אליה קישור לאימות ולהמשך ההקמה. כדאי לבדוק גם בתיקיית הספאם.');
        setPassword('');
        setConfirmPassword('');
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
        <h1 className="mt-5 text-2xl font-bold">{isRegister ? 'יוצרים אתר עסקי עם BTime' : 'התחברות ל-BTime'}</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          {isRegister ? 'מקימים אתר עסקי מקצועי עם קישור אישי ללקוחות וממשק ניהול פשוט לעדכון שירותים, מוצרים, תמונות ופרטי העסק — וגם לניהול פניות ותורים. מתחילים ב-30 ימי ניסיון ללא התחייבות.' : 'התחברו לממשק הניהול כדי לעדכן את האתר, לנהל פניות ותורים ולהמשיך להפעיל את העסק.'}
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
              className="w-full rounded-xl border border-slate-300 px-3 py-3 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" dir="ltr" placeholder="+972501234567 או +14155552671" />
            <p className="mt-1 text-xs text-slate-500">יש להזין קידומת מדינה. המספר נשמר לפרטי קשר בלבד; אימות החשבון ושיוך עסק קיים מתבצעים לפי כתובת המייל.</p>
          </div>}
          <PasswordField id="account-password" label="סיסמה" value={password} onChange={setPassword}
            autoComplete={isRegister ? 'new-password' : 'current-password'} minLength={isRegister ? 10 : 1} />
          {isRegister && <>
            <PasswordField id="account-confirm-password" label="אימות סיסמה" value={confirmPassword}
              onChange={setConfirmPassword} autoComplete="new-password" minLength={10} />
            <p className="mt-1 text-xs text-slate-500">הסיסמה צריכה להכיל לפחות 10 תווים. אין חובה לאות גדולה או לסימן מיוחד.</p>
            <div className="space-y-3 rounded-xl border border-slate-200 p-3 text-sm">
              <label className="flex items-start gap-2">
                <input type="checkbox" required checked={legalAccepted} onChange={e=>setLegalAccepted(e.target.checked)} className="mt-1 h-4 w-4" />
                <span>קראתי ואני מאשר/ת את <Link href="/platform-legal#terms_of_use" target="_blank" className="font-semibold text-blue-700 underline">תנאי השימוש</Link> ואת <Link href="/platform-legal#privacy_policy" target="_blank" className="font-semibold text-blue-700 underline">מדיניות הפרטיות</Link> של BTime.</span>
              </label>
              <div className="border-t border-slate-200 pt-3">
                <p className="mb-2 font-semibold">עדכונים והצעות שיווקיות (רשות)</p>
                <label className="mb-2 flex items-start gap-2">
                  <input type="checkbox" checked={marketingEmail} onChange={e=>setMarketingEmail(e.target.checked)} className="mt-1 h-4 w-4" />
                  <span>אני מסכים/ה לקבלת דיוור שיווקי ועדכונים בדוא״ל.</span>
                </label>
                <label className="flex items-start gap-2">
                  <input type="checkbox" checked={marketingSms} onChange={e=>setMarketingSms(e.target.checked)} className="mt-1 h-4 w-4" />
                  <span>אני מסכים/ה לקבלת דיוור שיווקי ועדכונים ב-SMS.</span>
                </label>
                <p className="mt-2 text-xs text-slate-500">ההסכמות נפרדות, אינן מסומנות מראש ואינן תנאי לפתיחת חשבון.</p>
              </div>
            </div>
          </>}
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
        <div className="mt-6 border-t border-slate-100 pt-4 text-center text-sm text-slate-600">
          צריכים עזרה? <a href="https://wa.me/972549910450" target="_blank" rel="noopener noreferrer" className="font-semibold text-green-700 underline underline-offset-2">אפשר לפנות אלינו ב-WhatsApp</a>
        </div>
      </section>
    </main>
  );
}
