'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';

type AccountUser = {
  id: string;
  email: string;
  phone: string;
  email_verified_at: string;
  business_id: string | null;
  business_name: string | null;
  business_slug: string | null;
  business_status: string | null;
  subscription_status: string | null;
  trial_ends_at: string | null;
  current_period_ends_at: string | null;
  deletion_request_status: string | null;
};

function dateLabel(value: string | null): string {
  if (!value) return 'לא הוגדר';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'לא ידוע' : date.toLocaleDateString('he-IL');
}

export default function AccountDashboard() {
  const [user,setUser]=useState<AccountUser|null>(null);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [name,setName]=useState('');
  const [slug,setSlug]=useState('');
  const [whatsapp,setWhatsapp]=useState('');
  const [reason,setReason]=useState('');

  async function loadAccount() {
    const response=await fetch('/api/auth/me',{cache:'no-store'});
    if(response.status===401){window.location.assign('/login');return;}
    const data=await response.json().catch(()=>null);
    if(!response.ok||!data?.user)throw new Error('לא ניתן לטעון את פרטי החשבון.');
    setUser(data.user as AccountUser);
  }

  useEffect(()=>{loadAccount().catch(err=>setError(err instanceof Error?err.message:'אירעה שגיאה.')).finally(()=>setLoading(false));},[]);

  async function createBusiness(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setSaving(true);setError('');setMessage('');
    try{
      const response=await fetch('/api/auth/business',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,slug, ...(whatsapp.trim()?{whatsapp_number:whatsapp.trim()}:{})}),cache:'no-store'});
      const data=await response.json().catch(()=>null);
      const messages:Record<string,string>={
        business_already_exists:'כבר משויך לחשבון הזה עסק.',
        business_contact_already_registered:'פרטי הקשר כבר משויכים לעסק קיים. אפשר לפנות לתמיכה.',
        slug_or_business_contact_already_exists:'כתובת העסק תפוסה או שפרטי הקשר כבר קיימים.',
        invalid_il_phone:'יש להזין מספר WhatsApp ישראלי תקין.',
        provisioning_not_configured:'שירות הקמת העסקים עדיין לא הוגדר.',
        business_provisioning_failed:'הקמת העסק נכשלה. לא נוצר עסק פעיל; אפשר לנסות שוב לאחר בדיקה.',
      };
      if(!response.ok)throw new Error(messages[data?.error]??data?.message??'לא ניתן להקים את העסק כרגע.');
      await loadAccount();
      setMessage('העסק הוקם בהצלחה. תקופת הניסיון שלך היא 30 יום.');
      setName('');setSlug('');setWhatsapp('');
    }catch(err){setError(err instanceof Error?err.message:'אירעה שגיאה.');}
    finally{setSaving(false);}
  }

  async function openManagement(){
    setSaving(true);setError('');
    try{
      const response=await fetch('/api/auth/management-link',{method:'POST',cache:'no-store'});
      const data=await response.json().catch(()=>null);
      if(!response.ok)throw new Error(response.status===403?'תקופת הניסיון הסתיימה או שהמנוי אינו פעיל. יש לפנות לבעל הפלטפורמה.':'לא ניתן ליצור קישור ניהול.');
      window.location.assign(data.management_url);
    }catch(err){setError(err instanceof Error?err.message:'אירעה שגיאה.');setSaving(false);}
  }

  async function cancelSubscription(){
    if(!window.confirm('לבטל את המנוי עכשיו? אתר הלקוחות וממשק ניהול העסק ייחסמו מיד, אך הנתונים יישמרו.'))return;
    setSaving(true);setError('');setMessage('');
    try{
      const response=await fetch('/api/auth/subscription/cancel',{method:'POST',cache:'no-store'});
      const data=await response.json().catch(()=>null);
      if(!response.ok)throw new Error(data?.message??'לא ניתן לבטל את המנוי.');
      setMessage(data?.message??'המנוי בוטל.');
      await loadAccount();
    }catch(err){setError(err instanceof Error?err.message:'אירעה שגיאה.');}
    finally{setSaving(false);}
  }

  async function requestDeletion(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setSaving(true);setError('');setMessage('');
    try{
      const response=await fetch('/api/auth/deletion-request',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({reason}),cache:'no-store'});
      const data=await response.json().catch(()=>null);
      if(!response.ok)throw new Error(data?.message??'לא ניתן לשלוח בקשת מחיקה.');
      setMessage(data?.message??'בקשת המחיקה נשלחה לאישור.');
      setReason('');
      await loadAccount();
    }catch(err){setError(err instanceof Error?err.message:'אירעה שגיאה.');}
    finally{setSaving(false);}
  }

  async function logout(){
    setSaving(true);
    await fetch('/api/auth/logout',{method:'POST',cache:'no-store'}).catch(()=>{});
    window.location.assign('/login');
  }

  if(loading)return <main dir="rtl" className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-600">טוען חשבון…</main>;

  const trialExpired=Boolean(user?.subscription_status==='trialing'&&user.trial_ends_at&&new Date(user.trial_ends_at).getTime()<=Date.now());
  const canManage=Boolean(user?.business_id&&!trialExpired&&user?.subscription_status!=='canceled'&&user?.subscription_status!=='suspended'&&user?.business_status==='active');

  return <main dir="rtl" className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 sm:py-12">
    <div className="mx-auto max-w-2xl">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div><p className="text-sm font-semibold text-blue-700">BTime</p><h1 className="mt-1 text-2xl font-bold">החשבון שלי</h1></div>
        <button type="button" onClick={logout} disabled={saving} className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold disabled:opacity-50">התנתקות</button>
      </header>
      {error&&<p role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {message&&<p role="status" className="mb-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">{message}</p>}
      {user&&<section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <h2 className="text-lg font-bold">פרטי החשבון</h2>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-slate-500">כתובת מייל</dt><dd className="mt-1 font-semibold" dir="ltr">{user.email}</dd></div>
          <div><dt className="text-slate-500">טלפון</dt><dd className="mt-1 font-semibold" dir="ltr">{user.phone}</dd></div>
        </dl>
      </section>}

      {user&&!user.business_id&&<section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <h2 className="text-lg font-bold">הקמת העסק שלך</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">לאחר יצירת העסק תתחיל תקופת ניסיון חינמית של 30 יום. אפשר להקים עסק אחד לכל חשבון.</p>
        <form onSubmit={createBusiness} className="mt-5 space-y-4">
          <div><label htmlFor="owner-business-name" className="mb-1.5 block text-sm font-semibold">שם העסק</label>
            <input id="owner-business-name" required minLength={2} maxLength={120} value={name} onChange={e=>setName(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-3" /></div>
          <div><label htmlFor="owner-business-slug" className="mb-1.5 block text-sm font-semibold">כתובת העסק באנגלית</label>
            <div className="flex items-center gap-2"><input id="owner-business-slug" required minLength={2} maxLength={63} pattern="[a-z0-9]+(-[a-z0-9]+)*" value={slug} onChange={e=>setSlug(e.target.value.toLowerCase())} dir="ltr" placeholder="my-business" className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-3 text-left" /><span className="text-xs text-slate-500">/biz/</span></div></div>
          <div><label htmlFor="owner-whatsapp" className="mb-1.5 block text-sm font-semibold">מספר WhatsApp של העסק (לא חובה)</label>
            <input id="owner-whatsapp" type="tel" value={whatsapp} onChange={e=>setWhatsapp(e.target.value)} dir="ltr" placeholder="05X-XXXXXXX" className="w-full rounded-xl border border-slate-300 px-3 py-3" /></div>
          <button type="submit" disabled={saving} className="w-full rounded-xl bg-slate-900 px-4 py-3 font-semibold text-white disabled:opacity-50">{saving?'מקים את העסק…':'הקמת עסק והתחלת תקופת ניסיון'}</button>
        </form>
      </section>}

      {user?.business_id&&<section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="text-lg font-bold">{user.business_name}</h2><p className="mt-1 text-sm text-slate-500" dir="ltr">/biz/{user.business_slug}</p></div>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${canManage?'bg-emerald-50 text-emerald-800':'bg-amber-50 text-amber-800'}`}>{canManage?'פעיל':trialExpired?'תקופת הניסיון הסתיימה':'לא פעיל'}</span>
        </div>
        <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-slate-500">סטטוס מנוי</dt><dd className="mt-1 font-semibold">{user.subscription_status==='trialing'?'תקופת ניסיון':user.subscription_status==='active'?'מנוי פעיל':user.subscription_status==='canceled'?'בוטל':user.subscription_status??'לא הוגדר'}</dd></div>
          <div><dt className="text-slate-500">סיום תקופת ניסיון</dt><dd className="mt-1 font-semibold">{dateLabel(user.trial_ends_at)}</dd></div>
          {user.current_period_ends_at&&<div><dt className="text-slate-500">תום תקופת המנוי</dt><dd className="mt-1 font-semibold">{dateLabel(user.current_period_ends_at)}</dd></div>}
          <div><dt className="text-slate-500">בקשת מחיקה</dt><dd className="mt-1 font-semibold">{user.deletion_request_status==='pending'?'ממתינה לאישור':user.deletion_request_status??'אין בקשה פתוחה'}</dd></div>
        </dl>
        {canManage?<button type="button" onClick={openManagement} disabled={saving} className="mt-5 w-full rounded-xl bg-slate-900 px-4 py-3 font-semibold text-white disabled:opacity-50">{saving?'מכין קישור…':'כניסה לניהול העסק'}</button>:<p className="mt-5 rounded-xl bg-amber-50 p-3 text-sm leading-6 text-amber-900">הגישה לאתר העסק ולממשק הניהול חסומה כרגע. הנתונים נשמרים. לפנייה לגבי חידוש המנוי יש ליצור קשר עם בעל הפלטפורמה.</p>}
        {user.subscription_status==='trialing'||user.subscription_status==='active'?<button type="button" onClick={cancelSubscription} disabled={saving} className="mt-3 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold disabled:opacity-50">ביטול מנוי וחסימת העסק</button>:null}
        {user.deletion_request_status!=='pending'&&<form onSubmit={requestDeletion} className="mt-6 border-t border-slate-200 pt-5">
          <h3 className="font-bold">בקשת מחיקה מלאה</h3>
          <p className="mt-1 text-sm leading-6 text-slate-600">הבקשה תועבר לאישור מנהל. לא יימחקו נתונים או מסד נתונים לפני אישור מפורש.</p>
          <label htmlFor="deletion-reason" className="mb-1.5 mt-3 block text-sm font-semibold">סיבה (לא חובה)</label>
          <textarea id="deletion-reason" rows={3} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2" />
          <button type="submit" disabled={saving} className="mt-3 w-full rounded-xl border border-red-300 px-4 py-3 text-sm font-semibold text-red-800 disabled:opacity-50">שליחת בקשת מחיקה לאישור</button>
        </form>}
      </section>}
      <p className="mt-6 text-center text-xs text-slate-500">הנתונים נשמרים כל עוד העסק לא אושר למחיקה מלאה.</p>
      <div className="mt-4 text-center"><Link href="/login" className="text-sm text-blue-700 underline">התחברות לחשבון אחר</Link></div>
    </div>
  </main>;
}
