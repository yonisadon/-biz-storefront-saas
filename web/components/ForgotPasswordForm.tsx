'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { PlatformLanguageSwitcher, usePlatformLanguage } from '@/components/PlatformLanguageProvider';

export default function ForgotPasswordForm() {
  const { t, language } = usePlatformLanguage();
  const [email,setEmail]=useState('');
  const [loading,setLoading]=useState(false);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setLoading(true);setError('');setMessage('');
    try{
      const response=await fetch('/api/auth/forgot-password',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email}),cache:'no-store'});
      const data=await response.json().catch(()=>null);
      if(!response.ok)throw new Error(t('forgotFailed'));
      setMessage(t('forgotSuccess'));
    }catch(err){setError(err instanceof Error?err.message:'אירעה שגיאה.');}
    finally{setLoading(false);}
  }
  return <main dir={language === "he" ? "rtl" : "ltr"} className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 text-slate-900">
    <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
      <div className="flex items-center justify-between"><p className="text-sm font-semibold text-blue-700">BTime</p><PlatformLanguageSwitcher /></div>
      <h1 className="mt-4 text-2xl font-bold">{t('forgotTitle')}</h1>
      <p className="mt-2 text-sm leading-6 text-slate-600">{t('forgotIntro')}</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <div><label htmlFor="reset-email" className="mb-1.5 block text-sm font-semibold">{t('email')}</label>
          <input id="reset-email" type="email" required maxLength={254} autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3 py-3" dir="ltr" /></div>
        {error&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        {message&&<p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">{message}</p>}
        <button type="submit" disabled={loading} className="w-full rounded-xl bg-slate-900 px-4 py-3 font-semibold text-white disabled:opacity-50">{loading?t('sending'):t('sendResetLink')}</button>
      </form>
      <Link href="/login" className="mt-5 inline-block text-sm font-semibold text-blue-700">{t('backToLogin')}</Link>
    </section>
  </main>;
}
