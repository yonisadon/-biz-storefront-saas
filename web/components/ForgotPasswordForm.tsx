'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';

export default function ForgotPasswordForm() {
  const [email,setEmail]=useState('');
  const [loading,setLoading]=useState(false);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setLoading(true);setError('');setMessage('');
    try{
      const response=await fetch('/api/auth/forgot-password',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email}),cache:'no-store'});
      const data=await response.json().catch(()=>null);
      if(!response.ok)throw new Error('לא ניתן לשלוח קישור איפוס כרגע.');
      setMessage('אם קיימת כתובת מייל מאומתת המשויכת לחשבון, יישלח אליה קישור חד-פעמי לאיפוס הסיסמה. תוקפו 30 דקות; כדאי לבדוק גם בספאם.');
    }catch(err){setError(err instanceof Error?err.message:'אירעה שגיאה.');}
    finally{setLoading(false);}
  }
  return <main dir="rtl" className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 text-slate-900">
    <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
      <p className="text-sm font-semibold text-blue-700">BTime</p>
      <h1 className="mt-4 text-2xl font-bold">איפוס סיסמה</h1>
      <p className="mt-2 text-sm leading-6 text-slate-600">לאחר שליחת הבקשה, יישלח קישור חד-פעמי לכתובת המייל המאומתת המשויכת לחשבון. הקישור יהיה בתוקף למשך 30 דקות.</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <div><label htmlFor="reset-email" className="mb-1.5 block text-sm font-semibold">כתובת מייל</label>
          <input id="reset-email" type="email" required maxLength={254} autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3 py-3" dir="ltr" /></div>
        {error&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        {message&&<p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">{message}</p>}
        <button type="submit" disabled={loading} className="w-full rounded-xl bg-slate-900 px-4 py-3 font-semibold text-white disabled:opacity-50">{loading?'שולח…':'שליחת קישור איפוס'}</button>
      </form>
      <Link href="/login" className="mt-5 inline-block text-sm font-semibold text-blue-700">חזרה להתחברות</Link>
    </section>
  </main>;
}
