'use client';

import { useState, type FormEvent } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { sameOriginManagementPath } from '@/lib/managementUrl';
import { PlatformLanguageSwitcher, usePlatformLanguage } from '@/components/PlatformLanguageProvider';

type Mode = 'register' | 'login';

function PasswordField({ id, label, value, onChange, autoComplete, minLength = 1 }: {
  id: string; label: string; value: string; onChange: (value: string) => void;
  autoComplete: string; minLength?: number;
}) {
  const [visible, setVisible] = useState(false);
  const { t, language } = usePlatformLanguage();
  return <div>
    <label htmlFor={id} className="mb-1.5 block text-sm font-semibold">{label}</label>
    <div className="relative">
      <input id={id} type={visible ? 'text' : 'password'} required minLength={minLength} maxLength={128}
        autoComplete={autoComplete} value={value} onChange={(event) => onChange(event.target.value)}
        className={`w-full rounded-xl border border-slate-300 px-3 py-3 ${language === 'he' ? 'pl-12' : 'pr-12'} outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100`} dir="ltr" />
      <button type="button" onClick={() => setVisible((current) => !current)}
        aria-label={visible ? t('hidePassword') : t('showPassword')} aria-pressed={visible}
        className={`absolute ${language === 'he' ? 'left-2' : 'right-2'} top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500`}>
        {visible ? <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8"/><path d="M9.9 5.2A10.8 10.8 0 0112 5c5 0 8.5 4.5 9.5 7-.4 1-1.3 2.3-2.6 3.5M6.2 6.2C3.8 7.7 2.5 10.1 2.5 12c1 2.5 4.5 7 9.5 7 1.3 0 2.5-.3 3.6-.8"/></svg>
          : <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z"/><circle cx="12" cy="12" r="3"/></svg>}
      </button>
    </div>
  </div>;
}

export default function AccountAuthForm({ mode, returnTo }: { mode: Mode; returnTo?: string }) {
  const { t, language } = usePlatformLanguage();
  const isRegister = mode === 'register';
  const pathname = usePathname();
  const legalReturnTo = encodeURIComponent(pathname || (isRegister ? '/register' : '/login'));
  const safeReturnTo = returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//')
    && !returnTo.includes('\\') && !/[\r\n]/.test(returnTo) ? returnTo : null;
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
    if (isRegister && password !== confirmPassword) { setError(t('passwordMismatch')); return; }
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
          invalid_credentials: t('invalidCredentials'),
          email_not_verified: t('emailNotVerified'),
          email_service_not_configured: t('emailServiceMissing'),
          invalid_phone: t('invalidPhone'),
          account_service_not_configured: t('accountServiceMissing'),
          validation_error: t('invalidField'),
          email_already_registered: t('emailAlreadyRegistered'),
          registration_failed: t('genericError'),
          login_failed: t('invalidCredentials'),
        };
        throw new Error(messages[data?.error] ?? t('genericError'));
      }
      if (isRegister) {
        setMessage(t('registrationSuccess'));
        setPassword('');
        setConfirmPassword('');
      } else {
        if (data?.role === 'super_admin') {
          window.location.assign('/platform-admin');
          return;
        }
        if (safeReturnTo) {
          window.location.assign(safeReturnTo);
          return;
        }
        const meResponse = await fetch('/api/auth/me', {
          cache: 'no-store',
          credentials: 'same-origin',
          headers: { 'Cache-Control': 'no-cache' },
        });
        const meData = await meResponse.json().catch(() => null);
        if (meResponse.ok && meData?.user?.business_id) {
          const linkResponse = await fetch('/api/auth/management-link', {
            method: 'POST',
            cache: 'no-store',
            credentials: 'same-origin',
          });
          const linkData = await linkResponse.json().catch(() => null);
          if (linkResponse.ok && linkData?.management_url) {
            const managementPath = sameOriginManagementPath(linkData.management_url);
            if (!managementPath) throw new Error(t('invalidManagementLink'));
            window.location.assign(managementPath);
            return;
          }
          if (linkData?.error === 'management_link_association_required') {
            window.location.assign('/account?managementLinkRecovery=1');
            return;
          }
        }
        window.location.assign('/account');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('genericError'));
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
      if (!response.ok) throw new Error(t('resendFailed'));
      setMessage(t('resendSuccess'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('genericError'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main dir={language === 'he' ? 'rtl' : 'ltr'} className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 text-slate-900">
      <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex items-center justify-between gap-3"><Link href="/" className="text-sm font-semibold text-blue-700">BTime</Link><PlatformLanguageSwitcher /></div>
        <h1 className="mt-3 text-2xl font-bold">{isRegister ? t('authRegisterTitle') : t('authLoginTitle')}</h1>
        <p className="mt-1.5 text-sm leading-6 text-slate-600">
          {isRegister ? t('authRegisterDescription') : t('authLoginDescription')}
        </p>
        <form onSubmit={submit} onInvalid={(event) => {
          const field = event.target as HTMLInputElement;
          if (!field || typeof field.setCustomValidity !== 'function') return;
          const validity = field.validity;
          const message = validity.valueMissing ? t('requiredField')
            : field.type === 'email' && validity.typeMismatch ? t('invalidEmail')
            : validity.tooShort ? t('fieldTooShort')
            : validity.patternMismatch ? t('invalidPattern')
            : validity.typeMismatch || validity.badInput ? t('invalidField') : '';
          if (message) field.setCustomValidity(message);
        }} onInput={(event) => {
          const field = event.target as HTMLInputElement;
          if (typeof field.setCustomValidity === 'function') field.setCustomValidity('');
        }} className="mt-4 space-y-3">
          <div>
            <label htmlFor="account-email" className="mb-1.5 block text-sm font-semibold">{t('email')}</label>
            <input id="account-email" type="email" required maxLength={254} autoComplete="email" value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-3 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" dir="ltr" />
          </div>
          {isRegister && <div>
            <label htmlFor="account-phone" className="mb-1.5 block text-sm font-semibold">{t('phone')}</label>
            <input id="account-phone" type="tel" required autoComplete="tel" value={phone}
              onChange={(event) => setPhone(event.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-3 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" dir="ltr" placeholder="+972501234567 / +14155552671" />
            <p className="mt-1 text-xs text-slate-500">{t('phoneHint')}</p>
          </div>}
          <PasswordField id="account-password" label={t('password')} value={password} onChange={setPassword}
            autoComplete={isRegister ? 'new-password' : 'current-password'} minLength={isRegister ? 10 : 1} />
          {isRegister && <>
            <PasswordField id="account-confirm-password" label={t('confirmPassword')} value={confirmPassword}
              onChange={setConfirmPassword} autoComplete="new-password" minLength={10} />
            <p className="mt-1 text-xs text-slate-500">{t('passwordHint')}</p>
            <div className="space-y-3 rounded-xl border border-slate-200 p-3 text-sm">
              <label className="flex items-start gap-2">
                <input type="checkbox" required checked={legalAccepted} onChange={e=>setLegalAccepted(e.target.checked)} className="mt-1 h-4 w-4" />
                <span>{t('termsIntro')} <Link href={`/platform-legal?returnTo=${legalReturnTo}#terms_of_use`} target="_blank" className="font-semibold text-blue-700 underline">{t('terms')}</Link> {t('and')} <Link href={`/platform-legal?returnTo=${legalReturnTo}#privacy_policy`} target="_blank" className="font-semibold text-blue-700 underline">{t('privacy')}</Link> {t('ofBtime')}</span>
              </label>
              <div className="border-t border-slate-200 pt-3">
                <p className="mb-2 font-semibold">{t('marketingOptional')}</p>
                <label className="mb-2 flex items-start gap-2">
                  <input type="checkbox" checked={marketingEmail} onChange={e=>setMarketingEmail(e.target.checked)} className="mt-1 h-4 w-4" />
                  <span>{t('marketingEmail')}</span>
                </label>
                <label className="flex items-start gap-2">
                  <input type="checkbox" checked={marketingSms} onChange={e=>setMarketingSms(e.target.checked)} className="mt-1 h-4 w-4" />
                  <span>{t('marketingSms')}</span>
                </label>
                <p className="mt-2 text-xs text-slate-500">{t('consentHint')}</p>
              </div>
            </div>
          </>}
          {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
          {message && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">{message}</p>}
          <button type="submit" disabled={loading} className="w-full rounded-xl bg-slate-900 px-4 py-3 font-semibold text-white disabled:opacity-60">
            {loading ? t('loading') : isRegister ? t('createAccount') : t('loginAction')}
          </button>
          {!isRegister && error === t('emailNotVerified') && <button type="button" disabled={loading || !email}
            onClick={resendVerification} className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold disabled:opacity-50">{t('resendVerification')}</button>}
        </form>
        <div className="mt-5 flex flex-wrap justify-between gap-3 text-sm">
          {isRegister ? <Link href="/login" className="font-semibold text-blue-700">{t('alreadyAccount')}</Link> : <>
            <Link href="/register" className="font-semibold text-blue-700">{t('newAccount')}</Link>
            <Link href="/forgot-password" className="text-slate-600 underline">{t('forgotPassword')}</Link>
          </>}
        </div>
        <div className="mt-6 border-t border-slate-100 pt-4 text-center text-sm text-slate-600">
          {t('needHelp')} <a href="https://wa.me/972549910450" target="_blank" rel="noopener noreferrer" className="font-semibold text-green-700 underline underline-offset-2">{t('contactWhatsapp')}</a>
        </div>
      </section>
    </main>
  );
}
