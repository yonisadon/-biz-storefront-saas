'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { PlatformLanguageSwitcher, usePlatformLanguage } from '@/components/PlatformLanguageProvider';

function PasswordField({ id, label, value, onChange }: {
  id: string; label: string; value: string; onChange: (value: string) => void;
}) {
  const [visible, setVisible] = useState(false);
  const { t, language } = usePlatformLanguage();
  return <div>
    <label htmlFor={id} className="mb-1.5 block text-sm font-semibold">{label}</label>
    <div className="relative">
      <input id={id} type={visible ? 'text' : 'password'} minLength={10} maxLength={128} required
        autoComplete="new-password" value={value} onChange={(event) => onChange(event.target.value)}
        className={`w-full rounded-xl border border-slate-300 px-3 py-3 ${language === 'he' ? 'pl-12' : 'pr-12'}`} dir="ltr" />
      <button type="button" onClick={() => setVisible((current) => !current)}
        aria-label={visible ? t('hidePassword') : t('showPassword')} aria-pressed={visible}
        className={`absolute ${language === 'he' ? 'left-2' : 'right-2'} top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500`}>
        {visible ? <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8"/><path d="M9.9 5.2A10.8 10.8 0 0112 5c5 0 8.5 4.5 9.5 7-.4 1-1.3 2.3-2.6 3.5M6.2 6.2C3.8 7.7 2.5 10.1 2.5 12c1 2.5 4.5 7 9.5 7 1.3 0 2.5-.3 3.6-.8"/></svg>
          : <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z"/><circle cx="12" cy="12" r="3"/></svg>}
      </button>
    </div>
  </div>;
}

export default function ResetPasswordClient({ token }: { token: string }) {
  const { t, language } = usePlatformLanguage();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    if (password !== confirm) { setError(t('passwordMismatch')); return; }
    setLoading(true);
    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, password }),
        cache: 'no-store',
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(t('resetInvalid'));
      setMessage(t('passwordUpdated'));
      setPassword('');
      setConfirm('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('genericError'));
    } finally {
      setLoading(false);
    }
  }

  return <main dir={language === "he" ? "rtl" : "ltr"} className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 text-slate-900">
    <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
      <div className="flex items-center justify-between"><p className="text-sm font-semibold text-blue-700">BTime</p><PlatformLanguageSwitcher /></div>
      <h1 className="mt-4 text-2xl font-bold">{t('resetTitle')}</h1>
      <form onSubmit={submit} onInvalid={(event) => { const field = event.target as HTMLInputElement; if (!field || typeof field.setCustomValidity !== 'function') return; const v = field.validity; const msg = v.valueMissing ? t('requiredField') : v.tooShort ? t('fieldTooShort') : t('invalidField'); if (msg) field.setCustomValidity(msg); }} onInput={(event) => { const field = event.target as HTMLInputElement; if (field && typeof field.setCustomValidity === 'function') field.setCustomValidity(''); }} className="mt-6 space-y-4">
        <PasswordField id="new-password" label={t("newPassword")} value={password} onChange={setPassword} />
        <PasswordField id="confirm-password" label={t("confirmPassword")} value={confirm} onChange={setConfirm} />
        {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        {message && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">{message}</p>}
        <button type="submit" disabled={loading || !token} className="w-full rounded-xl bg-slate-900 px-4 py-3 font-semibold text-white disabled:opacity-50">{loading ? t('updating') : t('updatePassword')}</button>
      </form>
      <Link href="/login" className="mt-5 inline-block text-sm font-semibold text-blue-700">{t('backToLogin')}</Link>
    </section>
  </main>;
}
