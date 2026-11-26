'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type React from 'react';
import { sameOriginManagementPath } from '@/lib/managementUrl';
import Link from 'next/link';
import { PlatformLanguageSwitcher, usePlatformLanguage } from '@/components/PlatformLanguageProvider';

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

function dateLabel(value: string | null, language: 'he' | 'en' | 'ru'): string {
  if (!value) return language === 'he' ? 'לא הוגדר' : language === 'en' ? 'Not set' : 'Не указано';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? (language === 'he' ? 'לא ידוע' : language === 'en' ? 'Unknown' : 'Неизвестно') : date.toLocaleDateString(language === 'he' ? 'he-IL' : language === 'ru' ? 'ru-RU' : 'en-US');
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
  const { t, language } = usePlatformLanguage();
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
    if(!response.ok||!data?.user)throw new Error(t('accountLoadFailed'));
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
      catch(err){clearAccountState();if(!cancelled)setError(err instanceof Error?err.message:t('accountGenericError'));}
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

  function localizeInvalidField(event: React.InvalidEvent<HTMLFormElement>) {
    const field = event.target as HTMLInputElement;
    if (!field || typeof field.setCustomValidity !== 'function') return;
    const validity = field.validity;
    const message = validity.valueMissing ? t('requiredField')
      : field.type === 'email' && validity.typeMismatch ? t('invalidEmail')
      : validity.tooShort ? t('fieldTooShort')
      : validity.patternMismatch ? t('invalidPattern')
      : validity.typeMismatch || validity.badInput ? t('invalidField') : '';
    if (message) field.setCustomValidity(message);
  }
  function clearFieldValidity(event: React.FormEvent<HTMLFormElement>) {
    const field = event.target as HTMLInputElement;
    if (field && typeof field.setCustomValidity === 'function') field.setCustomValidity('');
  }

  async function createBusiness(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setSaving(true);setError('');setMessage('');
    try{
      const response=await fetch('/api/auth/business',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,slug, ...(whatsapp.trim()?{whatsapp_number:whatsapp.trim()}:{})}),cache:'no-store'});
      const data=await response.json().catch(()=>null);
      const messages:Record<string,string>={
        business_already_exists:t('businessAlreadyExists'),
        business_contact_already_registered:t('businessContactTaken'),
        slug_or_business_contact_already_exists:t('businessSlugTaken'),
        invalid_il_phone:t('invalidWhatsapp'),
        provisioning_not_configured:t('provisioningMissing'),
        business_provisioning_failed:t('provisioningFailed'),
      };
      if(!response.ok)throw new Error(messages[data?.error]??t('cannotCreateBusiness'));
      if(data?.management_url){const path=sameOriginManagementPath(data.management_url);if(!path)throw new Error(t('invalidManagementLink'));window.location.assign(path);return;}
      await loadAccount();
      setMessage(t('createBusinessSuccess'));
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
        setError(t('managementLinkRecoveryIntro'));
        return;
      }
      if(!response.ok)throw new Error(response.status===403?t('trialInactive'):t('managementLinkUnavailable'));
      setManagementUrl(data.management_url);
      setManagementLinkNeedsAssociation(false);
    }catch(err){setError(err instanceof Error?err.message:'אירעה שגיאה.');}
    finally{setSaving(false);}
  }

  async function openManagement(){
    if(managementUrl){const path=sameOriginManagementPath(managementUrl);if(!path){setError(t('managementLinkStoredInvalid'));return;}window.location.assign(path);return;}
    setSaving(true);setError('');
    try{
      const response=await fetch('/api/auth/management-link',{method:'POST',cache:'no-store',credentials:'same-origin'});
      const data=await response.json().catch(()=>null);
      if(response.status===409&&data?.error==='management_link_association_required'){
        setManagementLinkNeedsAssociation(true);
        setError(t('managementLinkAssociationRequired'));
        return;
      }
      if(!response.ok)throw new Error(response.status===403?t('trialInactiveContact'):t('managementLinkUnavailable'));
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
      if(!response.ok)throw new Error(data?.error==='management_link_not_found'?t('invalidManagementLink'):t('genericError'));
      setLegacyManagementUrl('');
      setManagementLinkNeedsAssociation(false);
      setMessage(t('accountLinkAssociated'));
      await loadManagementLink();
    }catch(err){setError(err instanceof Error?err.message:'אירעה שגיאה.');}
    finally{setSaving(false);}
  }

  async function copyManagementLink(){
    if(!managementUrl)return;
    try{await navigator.clipboard.writeText(managementUrl);setMessage(t('linkCopied'));}
    catch{setError(t('copyManually'));}
  }

  async function cancelSubscription(){
    if(!window.confirm(t('cancelSubscriptionConfirm')))return;
    setSaving(true);setError('');setMessage('');
    try{
      const response=await fetch('/api/auth/subscription/cancel',{method:'POST',cache:'no-store'});
      const data=await response.json().catch(()=>null);
      if(!response.ok)throw new Error(t('genericError'));
      setMessage(t('subscriptionCanceled'));
      await loadAccount();
    }catch(err){setError(err instanceof Error?err.message:'אירעה שגיאה.');}
    finally{setSaving(false);}
  }

  async function requestDeletion(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setSaving(true);setError('');setMessage('');
    try{
      const response=await fetch('/api/auth/deletion-request',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({reason}),cache:'no-store'});
      const data=await response.json().catch(()=>null);
      if(!response.ok)throw new Error(t('genericError'));
      setMessage(t('deletionSent'));
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
      if(!response.ok)throw new Error(t('updateMailingFailed'));
      setMarketingEmail(data.marketingEmail===true);setMarketingSms(data.marketingSms===true);
      setMessage(t('mailingSaved'));
    }catch(err){setError(err instanceof Error?err.message:t('accountGenericError'));}
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

  if(loading)return <main dir={language === 'he' ? 'rtl' : 'ltr'} className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-600">{t('accountLoading')}</main>;

  const trialExpired=Boolean(user?.subscription_status==='trialing'&&user.trial_ends_at&&new Date(user.trial_ends_at).getTime()<=Date.now());
  const canManage=Boolean(user?.business_id&&!trialExpired&&user?.subscription_status!=='canceled'&&user?.subscription_status!=='suspended'&&user?.business_status==='active');
  const subscriptionEnd = user?.subscription_status === 'trialing' ? user.trial_ends_at : user?.subscription_status === 'active' ? user.current_period_ends_at : null;
  const subscriptionDaysRemaining = remainingDays(subscriptionEnd);

  return <main dir={language === 'he' ? 'rtl' : 'ltr'} className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 sm:py-12">
    <div className="mx-auto max-w-2xl">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div><p className="text-sm font-semibold text-blue-700">BTime</p><h1 className="mt-1 text-2xl font-bold">{t('accountTitle')}</h1></div>
        <PlatformLanguageSwitcher /><button type="button" onClick={logout} disabled={saving} className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold disabled:opacity-50">{t('logout')}</button>
      </header>
      {error&&<p role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {message&&<p role="status" className="mb-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">{message}</p>}
      {dashboardContent&&(dashboardContent.welcomeTitle||dashboardContent.welcomeMessage)&&<section className="mb-5 rounded-2xl border border-indigo-100 bg-white p-5 shadow-sm sm:p-6">
        {dashboardContent.welcomeTitle&&<h2 className="font-bold">{dashboardContent.welcomeTitle}</h2>}
        {dashboardContent.welcomeMessage&&<p className="mt-2 whitespace-pre-line text-sm leading-7 text-slate-600">{dashboardContent.welcomeMessage}</p>}
      </section>}
      {notifications.length>0&&<section aria-labelledby="platform-notifications-title" className="mb-5 rounded-2xl border border-indigo-100 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="platform-notifications-title" className="font-bold">{t('updatesFromBtime')}</h2>
          <span className="text-xs text-slate-500">{notifications.filter(item=>!item.in_app_read_at).length} {t('unreadMessages')}</span>
        </div>
        <div className="mt-3 divide-y divide-slate-100">
          {notifications.map(item=><article key={item.id} className="py-3 first:pt-0 last:pb-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-semibold text-slate-800">{item.title}</h3>
                <p className="mt-1 whitespace-pre-line text-sm leading-6 text-slate-600">{item.body}</p>
                <p className="mt-2 text-xs text-slate-400">{dateLabel(item.created_at)}</p>
              </div>
              {!item.in_app_read_at&&<button type="button" onClick={()=>markNotificationRead(item.id)} className="shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">{t('markRead')}</button>}
            </div>
          </article>)}
        </div>
      </section>}
      {user&&<section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <h2 className="text-lg font-bold">{t('accountDetails')}</h2>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-slate-500">{t('emailAddress')}</dt><dd className="mt-1 font-semibold" dir="ltr">{user.email}</dd></div>
          <div><dt className="text-slate-500">{t('phoneLabel')}</dt><dd className="mt-1 font-semibold" dir="ltr">{user.phone}</dd></div>
        </dl>
      </section>}

      {user&&!user.business_id&&<section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <h2 className="text-lg font-bold">{t('businessSetup')}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">{t('businessSetupIntro')}</p>
        <form onSubmit={createBusiness} onInvalid={localizeInvalidField} onInput={clearFieldValidity} className="mt-5 space-y-4">
          <div><label htmlFor="owner-business-name" className="mb-1.5 block text-sm font-semibold">{t('businessName')}</label>
            <input id="owner-business-name" required minLength={2} maxLength={120} value={name} onChange={e=>setName(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-3" /></div>
          <div><label htmlFor="owner-business-slug" className="mb-1.5 block text-sm font-semibold">{t('businessAddressEnglish')}</label>
            <div className="flex items-center gap-2"><input id="owner-business-slug" required minLength={2} maxLength={63} pattern="[a-z0-9]+(-[a-z0-9]+)*" value={slug} onChange={e=>setSlug(e.target.value.toLowerCase())} dir="ltr" placeholder="my-business" className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-3 text-left" /><span className="text-xs text-slate-500">/biz/</span></div></div>
          <div><label htmlFor="owner-whatsapp" className="mb-1.5 block text-sm font-semibold">{t('businessWhatsapp')}</label>
            <input id="owner-whatsapp" type="tel" value={whatsapp} onChange={e=>setWhatsapp(e.target.value)} dir="ltr" placeholder="05X-XXXXXXX" className="w-full rounded-xl border border-slate-300 px-3 py-3" /></div>
          <button type="submit" disabled={saving} className="w-full rounded-xl bg-slate-900 px-4 py-3 font-semibold text-white disabled:opacity-50">{saving?t('creatingBusiness'):t('createBusiness')}</button>
        </form>
      </section>}

      {user&&consentsLoaded&&<section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <h2 className="font-bold">{t('mailingPreferences')}</h2>
        <p className="mt-1 text-sm leading-6 text-slate-600">{t('mailingIntro')}</p>
        <div className="mt-4 space-y-3 text-sm">
          <label className="flex items-start gap-2"><input type="checkbox" checked={marketingEmail} onChange={e=>setMarketingEmail(e.target.checked)} className="mt-1 h-4 w-4" /><span>{t('receiveMarketingEmail')}</span></label>
          <label className="flex items-start gap-2"><input type="checkbox" checked={marketingSms} onChange={e=>setMarketingSms(e.target.checked)} className="mt-1 h-4 w-4" /><span>{t('receiveMarketingSms')}</span></label>
        </div>
        <button type="button" onClick={saveConsents} disabled={saving} className="mt-4 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{saving?t('saving'):t('savePreferences')}</button>
      </section>}

      <section className="mt-5 rounded-2xl border border-blue-100 bg-white p-5 shadow-sm sm:p-6">
        <h2 className="font-bold">{t('help')}</h2>
        <p className="mt-1 text-sm leading-6 text-slate-600">{t('supportIntro')}</p>
        <div className="mt-3 flex flex-wrap gap-3 text-sm font-semibold">
          <a href="mailto:matchmakeradm1992@gmail.com" className="text-blue-700 underline">{t('sendSupportEmail')}</a>
          <a href="https://wa.me/972549910450" target="_blank" rel="noreferrer" className="text-green-700 underline">{t('contactWhatsapp')}</a>
        </div>
      </section>

      {user?.business_id&&<section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="text-lg font-bold">{user.business_name}</h2><p className="mt-1 text-sm text-slate-500" dir="ltr">/biz/{user.business_slug}</p></div>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${canManage?'bg-emerald-50 text-emerald-800':'bg-amber-50 text-amber-800'}`}>{canManage?t('active'):trialExpired?t('trialExpired'):t('inactive')}</span>
        </div>
        <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-slate-500">{t('subscriptionStatus')}</dt><dd className="mt-1 font-semibold">{user.subscription_status==='trialing'?t('trialPeriod'):user.subscription_status==='active'?t('activeSubscription'):user.subscription_status==='canceled'?t('canceled'):user.subscription_status??t('notSet')}</dd></div>
          <div><dt className="text-slate-500">{t('joinDate')}</dt><dd className="mt-1 font-semibold">{dateLabel(user.created_at, language)}</dd></div>
          <div><dt className="text-slate-500">{user.subscription_status==='trialing'?t('daysRemainingTrial'):t('daysUntilPeriodEnd')}</dt><dd className="mt-1 font-semibold">{subscriptionDaysRemaining===null?(user.subscription_status==='active'?t('noEndDate'):t('notRelevant')):subscriptionDaysRemaining===0?t('periodEnded'):String(subscriptionDaysRemaining)+(language==='he'?' ימים':language==='en'?' days':' дней')}</dd></div>
          <div><dt className="text-slate-500">{t('trialEndDate')}</dt><dd className="mt-1 font-semibold">{dateLabel(user.trial_ends_at, language)}</dd></div>
          {user.current_period_ends_at&&<div><dt className="text-slate-500">{t('subscriptionEndDate')}</dt><dd className="mt-1 font-semibold">{dateLabel(user.current_period_ends_at, language)}</dd></div>}
          <div><dt className="text-slate-500">{t('deletionRequest')}</dt><dd className="mt-1 font-semibold">{user.deletion_request_status==='pending'?t('pendingApproval'):user.deletion_request_status??t('noOpenRequest')}</dd></div>
        </dl>
        {canManage?<>
          <button type="button" onClick={openManagement} disabled={saving} className="mt-5 w-full rounded-xl bg-slate-900 px-4 py-3 font-semibold text-white disabled:opacity-50">{saving?t('openingManagement'):t('enterManagement')}</button>
          <button type="button" onClick={loadManagementLink} disabled={saving} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold disabled:opacity-50">{t('showPermanentLink')}</button>
          {managementUrl&&<div className="mt-3 rounded-xl bg-slate-50 p-3">
            <p className="mb-2 text-xs font-semibold text-slate-600">{t('permanentBusinessLink')}</p>
            <input readOnly value={managementUrl} dir="ltr" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-xs" />
            <button type="button" onClick={copyManagementLink} className="mt-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold">{t('copyLink')}</button>
          </div>}
          {managementLinkNeedsAssociation&&<div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <p className="text-sm font-semibold text-amber-900">{t('linkAssociation')}</p>
            <p className="mt-1 text-xs leading-5 text-amber-900">{t('managementLinkRecoveryIntro')}</p>
            <input value={legacyManagementUrl} onChange={e=>setLegacyManagementUrl(e.target.value)} dir="ltr" placeholder="https://.../manage/..." className="mt-2 w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-left text-xs" />
            <button type="button" onClick={associateManagementLink} disabled={saving||!legacyManagementUrl.trim()} className="mt-2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{t('associateLink')}</button>
          </div>}
        </>:<p className="mt-5 rounded-xl bg-amber-50 p-3 text-sm leading-6 text-amber-900">{t('blockedAccess')}</p>}
        {user.subscription_status==='trialing'||user.subscription_status==='active'?<button type="button" onClick={cancelSubscription} disabled={saving} className="mt-3 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold disabled:opacity-50">{t('cancelSubscription')}</button>:null}
        {user.deletion_request_status!=='pending'&&<form onSubmit={requestDeletion} onInvalid={localizeInvalidField} onInput={clearFieldValidity} className="mt-6 border-t border-slate-200 pt-5">
          <h3 className="font-bold">{t('deletionTitle')}</h3>
          <p className="mt-1 text-sm leading-6 text-slate-600">{t('deletionIntro')}</p>
          <label htmlFor="deletion-reason" className="mb-1.5 mt-3 block text-sm font-semibold">{t('deletionReason')}</label>
          <textarea id="deletion-reason" rows={3} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2" />
          <button type="submit" disabled={saving} className="mt-3 w-full rounded-xl border border-red-300 px-4 py-3 text-sm font-semibold text-red-800 disabled:opacity-50">{t('sendDeletionRequest')}</button>
        </form>}
      </section>}
      <p className="mt-6 text-center text-xs text-slate-500">{t('dataRetentionNote')}</p>
      <nav aria-label="מסמכי BTime" className="mt-4 flex flex-wrap justify-center gap-4 text-xs text-slate-500">
        <Link href="/platform-legal?returnTo=%2Faccount#terms_of_use" className="underline">תנאי שימוש</Link>
        <Link href="/platform-legal?returnTo=%2Faccount#privacy_policy" className="underline">מדיניות פרטיות</Link>
        <Link href="/platform-legal?returnTo=%2Faccount#accessibility_statement" className="underline">הצהרת נגישות</Link>
        <Link href="/login" className="underline">התחברות לחשבון אחר</Link>
      </nav>
    </div>
  </main>;
}
