'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { sameOriginManagementPath } from '@/lib/managementUrl';
import Link from 'next/link';

type PlatformNotification = { id: string; title: string; body: string; created_at: string; in_app_read_at: string | null };
type OwnerDashboardContent = { welcomeTitle?: string; welcomeMessage?: string };

type AccountUser = {
  id: string;
  role: string;
  email: string;
  phone: string;
  email_verified_at: string;
  created_at: string;
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

function remainingDays(value: string | null): number | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.ceil((timestamp - Date.now()) / 86_400_000));
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

export default function AccountDashboard() {
  const [user,setUser]=useState<AccountUser|null>(null);
  const [notifications,setNotifications]=useState<PlatformNotification[]>([]);
  const [dashboardContent,setDashboardContent]=useState<OwnerDashboardContent|null>(null);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [name,setName]=useState('');
  const [slug,setSlug]=useState('');
  const [whatsapp,setWhatsapp]=useState('');
  const [reason,setReason]=useState('');
  const [marketingEmail,setMarketingEmail]=useState(false);
  const [marketingSms,setMarketingSms]=useState(false);
  const [consentsLoaded,setConsentsLoaded]=useState(false);
  const [managementUrl,setManagementUrl]=useState('');
  const [legacyManagementUrl,setLegacyManagementUrl]=useState('');
  const [managementLinkNeedsAssociation,setManagementLinkNeedsAssociation]=useState(false);

  function clearAccountState() {
    setUser(null);
    setNotifications([]);
    setDashboardContent(null);
    setConsentsLoaded(false);
    setManagementUrl('');
    setLegacyManagementUrl('');
    setManagementLinkNeedsAssociation(false);
    setMarketingEmail(false);
    setMarketingSms(false);
    setName('');
    setSlug('');
    setWhatsapp('');
    setReason('');
    setSaving(false);
  }

  async function loadAccount() {
    const response=await fetch('/api/auth/me',{cache:'no-store',credentials:'same-origin',headers:{'Cache-Control':'no-cache'}});
    if(response.status===401){clearAccountState();window.location.replace('/login?next=%2Faccount');return;}
    const data=await response.json().catch(()=>null);
    if(!response.ok||!data?.user)throw new Error('לא ניתן לטעון את פרטי החשבון.');
    if (data.user.role === 'super_admin') { clearAccountState();window.location.replace('/platform-admin'); return; }
    setUser(data.user as AccountUser);
    const notificationResponse=await fetch('/api/auth/notifications',{cache:'no-store',credentials:'same-origin'}).catch(()=>null);
    if(notificationResponse?.ok){
      const notificationData=await notificationResponse.json().catch(()=>null);
      setNotifications((notificationData?.notifications??[]) as PlatformNotification[]);
    }
    const dashboardResponse=await fetch('/api/auth/platform-content',{cache:'no-store',credentials:'same-origin'}).catch(()=>null);
    if(dashboardResponse?.ok){
      const dashboardData=await dashboardResponse.json().catch(()=>null);
      setDashboardContent(dashboardData?.content??null);
    }
    const consentResponse=await fetch('/api/auth/consents',{cache:'no-store',credentials:'same-origin'});
    const consentData=await consentResponse.json().catch(()=>null);
    if(consentResponse.ok){setMarketingEmail(consentData.marketingEmail===true);setMarketingSms(consentData.marketingSms===true);setConsentsLoaded(true);}
  }

  useEffect(()=>{
    if(new URLSearchParams(window.location.search).get('managementLinkRecovery')==='1')setManagementLinkNeedsAssociation(true);
    let cancelled=false;
    let loadingRequest=false;
    const refreshAccount=async()=>{
      if(loadingRequest||cancelled)return;
      loadingRequest=true;
      setLoading(true);
      setError('');
      setMessage('');
      try{await loadAccount();}
      catch(err){clearAccountState();if(!cancelled)setError(err instanceof Error?err.message:'אירעה שגיאה.');}
      finally{loadingRequest=false;if(!cancelled)setLoading(false);}
    };
    const endSession=()=>{
      clearAccountState();
      setLoading(true);
      window.location.replace('/login');
    };
    const handlePageShow=()=>{void refreshAccount();};
    const handleStorage=(event:StorageEvent)=>{if(event.key==='btime-session-ended')endSession();};
    const channel=typeof BroadcastChannel!=='undefined'?new BroadcastChannel('btime-auth'):null;
    const handleBroadcast=(event:MessageEvent)=>{if(event.data==='session-ended')endSession();};
    window.addEventListener('pageshow',handlePageShow);
    window.addEventListener('storage',handleStorage);
    channel?.addEventListener('message',handleBroadcast);
    void refreshAccount();
    return()=>{
      cancelled=true;
      window.removeEventListener('pageshow',handlePageShow);
      window.removeEventListener('storage',handleStorage);
      channel?.removeEventListener('message',handleBroadcast);
      channel?.close();
    };
  },[]);

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
      if(data?.management_url){const path=sameOriginManagementPath(data.management_url);if(!path)throw new Error('קישור הניהול שהתקבל אינו תקין.');window.location.assign(path);return;}
      await loadAccount();
      setMessage('העסק הוקם בהצלחה. תקופת הניסיון שלך היא 30 יום.');
      setName('');setSlug('');setWhatsapp('');
    }catch(err){setError(err instanceof Error?err.message:'אירעה שגיאה.');}
    finally{setSaving(false);}
  }

  async function loadManagementLink(){
    setSaving(true);setError('');setMessage('');
    try{
      const response=await fetch('/api/auth/management-link',{method:'POST',cache:'no-store',credentials:'same-origin'});
      const data=await response.json().catch(()=>null);
      if(response.status===409&&data?.error==='management_link_association_required'){
        setManagementLinkNeedsAssociation(true);
        setError('הקישור הקבוע של העסק נוצר בעבר ונשמר רק כטביעת אבטחה. כדי לשמור אותו מחדש, יש להדביק כאן את הקישור הקיים או לבקש מהסופר־אדמין לאתר עותק.');
        return;
      }
      if(!response.ok)throw new Error(response.status===403?'תקופת הניסיון הסתיימה או שהמנוי אינו פעיל.':'לא ניתן לטעון את קישור הניהול.');
      setManagementUrl(data.management_url);
      setManagementLinkNeedsAssociation(false);
    }catch(err){setError(err instanceof Error?err.message:'אירעה שגיאה.');}
    finally{setSaving(false);}
  }

  async function openManagement(){
    if(managementUrl){const path=sameOriginManagementPath(managementUrl);if(!path){setError('קישור הניהול השמור אינו תקין.');return;}window.location.assign(path);return;}
    setSaving(true);setError('');
    try{
      const response=await fetch('/api/auth/management-link',{method:'POST',cache:'no-store',credentials:'same-origin'});
      const data=await response.json().catch(()=>null);
      if(response.status===409&&data?.error==='management_link_association_required'){
        setManagementLinkNeedsAssociation(true);
        setError('נדרש לשייך את קישור הניהול הקיים לחשבון לפני הכניסה.');
        return;
      }
      if(!response.ok)throw new Error(response.status===403?'תקופת הניסיון הסתיימה או שהמנוי אינו פעיל. יש לפנות לבעל הפלטפורמה.':'לא ניתן לטעון את קישור הניהול.');
      const path=sameOriginManagementPath(data.management_url);
      if(!path)throw new Error('קישור הניהול שהתקבל אינו תקין.');
      setManagementUrl(data.management_url);
      window.location.assign(path);
    }catch(err){setError(err instanceof Error?err.message:'אירעה שגיאה.');}
    finally{setSaving(false);}
  }

  async function associateManagementLink(){
    setSaving(true);setError('');setMessage('');
    try{
      const response=await fetch('/api/auth/management-link/associate',{
        method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({management_url:legacyManagementUrl.trim()}),cache:'no-store',credentials:'same-origin',
      });
      const data=await response.json().catch(()=>null);
      if(!response.ok)throw new Error(data?.error==='management_link_not_found'?'הקישור אינו שייך לעסק שמחובר לחשבון הזה. בדוק שהדבקת את הקישור הנכון.':data?.message??'לא ניתן לשייך את הקישור.');
      setLegacyManagementUrl('');
      setManagementLinkNeedsAssociation(false);
      setMessage('קישור הניהול הקבוע שויך לחשבון בהצלחה.');
      await loadManagementLink();
    }catch(err){setError(err instanceof Error?err.message:'אירעה שגיאה.');}
    finally{setSaving(false);}
  }

  async function copyManagementLink(){
    if(!managementUrl)return;
    try{await navigator.clipboard.writeText(managementUrl);setMessage('קישור הניהול הועתק.');}
    catch{setError('לא ניתן להעתיק אוטומטית. אפשר לסמן ולהעתיק את הקישור שמופיע.');}
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

  async function markNotificationRead(id:string){
    try{
      const response=await fetch('/api/auth/notifications/'+id+'/read',{method:'POST',cache:'no-store',credentials:'same-origin'});
      if(!response.ok)return;
      setNotifications(current=>current.map(item=>item.id===id?{...item,in_app_read_at:new Date().toISOString()}:item));
    }catch{}
  }

  async function saveConsents(){
    setSaving(true);setError('');setMessage('');
    try{
      const response=await fetch('/api/auth/consents',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({marketingEmail,marketingSms}),cache:'no-store'});
      const data=await response.json().catch(()=>null);
      if(!response.ok)throw new Error(data?.message??'לא ניתן לעדכן את העדפות הדיוור.');
      setMarketingEmail(data.marketingEmail===true);setMarketingSms(data.marketingSms===true);
      setMessage('העדפות הדיוור נשמרו. אפשר לשנות אותן בכל עת.');
    }catch(err){setError(err instanceof Error?err.message:'עדכון ההעדפות נכשל.');}
    finally{setSaving(false);}
  }

  async function logout(){
    setSaving(true);
    await fetchWithTimeout('/api/auth/logout',{method:'POST',cache:'no-store',credentials:'same-origin'},5000).catch(()=>{});
    clearAccountState();
    try{window.localStorage.setItem('btime-session-ended',String(Date.now()));}catch{}
    try{const channel=new BroadcastChannel('btime-auth');channel.postMessage('session-ended');channel.close();}catch{}
    window.location.replace('/login');
  }

  if(loading)return <main dir="rtl" className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-600">טוען חשבון…</main>;

  const trialExpired=Boolean(user?.subscription_status==='trialing'&&user.trial_ends_at&&new Date(user.trial_ends_at).getTime()<=Date.now());
  const canManage=Boolean(user?.business_id&&!trialExpired&&user?.subscription_status!=='canceled'&&user?.subscription_status!=='suspended'&&user?.business_status==='active');
  const subscriptionEnd = user?.subscription_status === 'trialing' ? user.trial_ends_at : user?.subscription_status === 'active' ? user.current_period_ends_at : null;
  const subscriptionDaysRemaining = remainingDays(subscriptionEnd);

  return <main dir="rtl" className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 sm:py-12">
    <div className="mx-auto max-w-2xl">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div><p className="text-sm font-semibold text-blue-700">BTime</p><h1 className="mt-1 text-2xl font-bold">החשבון שלי</h1></div>
        <button type="button" onClick={logout} disabled={saving} className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold disabled:opacity-50">התנתקות</button>
      </header>
      {error&&<p role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {message&&<p role="status" className="mb-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">{message}</p>}
      {dashboardContent&&(dashboardContent.welcomeTitle||dashboardContent.welcomeMessage)&&<section className="mb-5 rounded-2xl border border-indigo-100 bg-white p-5 shadow-sm sm:p-6">
        {dashboardContent.welcomeTitle&&<h2 className="font-bold">{dashboardContent.welcomeTitle}</h2>}
        {dashboardContent.welcomeMessage&&<p className="mt-2 whitespace-pre-line text-sm leading-7 text-slate-600">{dashboardContent.welcomeMessage}</p>}
      </section>}
      {notifications.length>0&&<section aria-labelledby="platform-notifications-title" className="mb-5 rounded-2xl border border-indigo-100 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="platform-notifications-title" className="font-bold">עדכונים מ-BTime</h2>
          <span className="text-xs text-slate-500">{notifications.filter(item=>!item.in_app_read_at).length} הודעות שלא נקראו</span>
        </div>
        <div className="mt-3 divide-y divide-slate-100">
          {notifications.map(item=><article key={item.id} className="py-3 first:pt-0 last:pb-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-semibold text-slate-800">{item.title}</h3>
                <p className="mt-1 whitespace-pre-line text-sm leading-6 text-slate-600">{item.body}</p>
                <p className="mt-2 text-xs text-slate-400">{dateLabel(item.created_at)}</p>
              </div>
              {!item.in_app_read_at&&<button type="button" onClick={()=>markNotificationRead(item.id)} className="shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">סימון כנקרא</button>}
            </div>
          </article>)}
        </div>
      </section>}
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

      {user&&consentsLoaded&&<section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <h2 className="font-bold">העדפות דיוור ועדכונים</h2>
        <p className="mt-1 text-sm leading-6 text-slate-600">אפשר לבחור בנפרד אם לקבל הודעות שיווקיות בדוא״ל או ב-SMS. הודעות שירות הכרחיות לחשבון נשלחות בנפרד.</p>
        <div className="mt-4 space-y-3 text-sm">
          <label className="flex items-start gap-2"><input type="checkbox" checked={marketingEmail} onChange={e=>setMarketingEmail(e.target.checked)} className="mt-1 h-4 w-4" /><span>קבלת דיוור שיווקי ועדכונים בדוא״ל</span></label>
          <label className="flex items-start gap-2"><input type="checkbox" checked={marketingSms} onChange={e=>setMarketingSms(e.target.checked)} className="mt-1 h-4 w-4" /><span>קבלת דיוור שיווקי ועדכונים ב-SMS</span></label>
        </div>
        <button type="button" onClick={saveConsents} disabled={saving} className="mt-4 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{saving?'שומר…':'שמירת העדפות'}</button>
      </section>}

      <section className="mt-5 rounded-2xl border border-blue-100 bg-white p-5 shadow-sm sm:p-6">
        <h2 className="font-bold">צריכים עזרה?</h2>
        <p className="mt-1 text-sm leading-6 text-slate-600">אפשר לפנות לתמיכת BTime במייל או ב-WhatsApp.</p>
        <div className="mt-3 flex flex-wrap gap-3 text-sm font-semibold">
          <a href="mailto:matchmakeradm1992@gmail.com" className="text-blue-700 underline">שליחת מייל לתמיכה</a>
          <a href="https://wa.me/972549910450" target="_blank" rel="noreferrer" className="text-green-700 underline">פנייה ב-WhatsApp</a>
        </div>
      </section>

      {user?.business_id&&<section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="text-lg font-bold">{user.business_name}</h2><p className="mt-1 text-sm text-slate-500" dir="ltr">/biz/{user.business_slug}</p></div>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${canManage?'bg-emerald-50 text-emerald-800':'bg-amber-50 text-amber-800'}`}>{canManage?'פעיל':trialExpired?'תקופת הניסיון הסתיימה':'לא פעיל'}</span>
        </div>
        <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-slate-500">סטטוס מנוי</dt><dd className="mt-1 font-semibold">{user.subscription_status==='trialing'?'תקופת ניסיון':user.subscription_status==='active'?'מנוי פעיל':user.subscription_status==='canceled'?'בוטל':user.subscription_status??'לא הוגדר'}</dd></div>
          <div><dt className="text-slate-500">תאריך הצטרפות</dt><dd className="mt-1 font-semibold">{dateLabel(user.created_at)}</dd></div>
          <div><dt className="text-slate-500">{user.subscription_status==='trialing'?'ימים שנותרו בתקופת הניסיון':'ימים עד תום התקופה'}</dt><dd className="mt-1 font-semibold">{subscriptionDaysRemaining===null?(user.subscription_status==='active'?'ללא תאריך סיום מוגדר':'לא רלוונטי'):subscriptionDaysRemaining===0?'התקופה הסתיימה':String(subscriptionDaysRemaining)+' ימים'}</dd></div>
          <div><dt className="text-slate-500">סיום תקופת ניסיון</dt><dd className="mt-1 font-semibold">{dateLabel(user.trial_ends_at)}</dd></div>
          {user.current_period_ends_at&&<div><dt className="text-slate-500">תום תקופת המנוי</dt><dd className="mt-1 font-semibold">{dateLabel(user.current_period_ends_at)}</dd></div>}
          <div><dt className="text-slate-500">בקשת מחיקה</dt><dd className="mt-1 font-semibold">{user.deletion_request_status==='pending'?'ממתינה לאישור':user.deletion_request_status??'אין בקשה פתוחה'}</dd></div>
        </dl>
        {canManage?<>
          <button type="button" onClick={openManagement} disabled={saving} className="mt-5 w-full rounded-xl bg-slate-900 px-4 py-3 font-semibold text-white disabled:opacity-50">{saving?'פותח את סביבת הניהול…':'כניסה לניהול העסק'}</button>
          <button type="button" onClick={loadManagementLink} disabled={saving} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold disabled:opacity-50">הצגת קישור הניהול הקבוע</button>
          {managementUrl&&<div className="mt-3 rounded-xl bg-slate-50 p-3">
            <p className="mb-2 text-xs font-semibold text-slate-600">קישור הניהול הקבוע של העסק</p>
            <input readOnly value={managementUrl} dir="ltr" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-xs" />
            <button type="button" onClick={copyManagementLink} className="mt-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold">העתקת הקישור</button>
          </div>}
          {managementLinkNeedsAssociation&&<div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <p className="text-sm font-semibold text-amber-900">שיוך קישור הניהול הקיים</p>
            <p className="mt-1 text-xs leading-5 text-amber-900">הקישור המקורי אינו ניתן לשחזור מתוך טביעת האבטחה בלבד. אם שמרת עותק של הקישור, הדבק אותו כאן פעם אחת. אם אין לך עותק, פנה לסופר־אדמין לבדיקה.</p>
            <input value={legacyManagementUrl} onChange={e=>setLegacyManagementUrl(e.target.value)} dir="ltr" placeholder="https://.../manage/..." className="mt-2 w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-left text-xs" />
            <button type="button" onClick={associateManagementLink} disabled={saving||!legacyManagementUrl.trim()} className="mt-2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">שיוך הקישור לחשבון</button>
          </div>}
        </>:<p className="mt-5 rounded-xl bg-amber-50 p-3 text-sm leading-6 text-amber-900">הגישה לאתר העסק ולממשק הניהול חסומה כרגע. הנתונים נשמרים. לפנייה לגבי חידוש המנוי יש ליצור קשר עם בעל הפלטפורמה.</p>}
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
      <nav aria-label="מסמכי BTime" className="mt-4 flex flex-wrap justify-center gap-4 text-xs text-slate-500">
        <Link href="/platform-legal?returnTo=%2Faccount#terms_of_use" className="underline">תנאי שימוש</Link>
        <Link href="/platform-legal?returnTo=%2Faccount#privacy_policy" className="underline">מדיניות פרטיות</Link>
        <Link href="/platform-legal?returnTo=%2Faccount#accessibility_statement" className="underline">הצהרת נגישות</Link>
        <Link href="/login" className="underline">התחברות לחשבון אחר</Link>
      </nav>
    </div>
  </main>;
}
