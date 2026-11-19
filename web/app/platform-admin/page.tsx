'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { FormEvent } from 'react';
import PalettePicker from '@/components/PalettePicker';
import StorefrontDesignPicker from '@/components/StorefrontDesignPicker';
import { BRAND_PALETTES, type PaletteId } from '@/lib/palettes';

type CreatedBusiness = {
  id: string;
  name: string;
  slug: string;
  database: string;
  public_url: string;
  management_url: string;
  status: string;
};

type BusinessOption = { id: string; name: string; slug: string; status: string; email?: string | null; phone?: string | null; owner_email?: string | null; owner_phone?: string | null; owner_email_verified?: boolean; created_at?: string; subscription_status?: string | null; trial_ends_at?: string | null; current_period_ends_at?: string | null; deletion_request_status?: string | null; domains: { domain: string; is_verified: boolean; is_primary: boolean }[] };
type AdminOverview = { total_businesses: number; active_businesses: number; suspended_businesses: number; trialing_subscriptions: number; paid_subscriptions: number; pending_deletion_requests: number };
type DeletionRequest = { id: string; tenant_id: string | null; reason: string | null; status: string; requested_at: string; business_name: string; business_slug: string; owner_email?: string | null; owner_phone?: string | null; database_name?: string | null };

type DomainSetup = { domain: string; verified: boolean; verification: { type: string; name: string; value: string }; next_step: string };

export default function PlatformAdminPage() {
  const [accessState, setAccessState] = useState<'checking' | 'allowed'>('checking');
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [phone, setPhone] = useState('');
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [email, setEmail] = useState('');
  const [palette, setPalette] = useState<PaletteId>('natural');
  const [storefrontTheme, setStorefrontTheme] = useState<'soft' | 'flat' | 'editorial' | 'creative'>('soft');
  const [galleryLayout, setGalleryLayout] = useState<'slider' | 'thumbnails'>('slider');
  const [productLayout, setProductLayout] = useState<'cards' | 'list' | 'carousel' | 'luxury_catalog'>('cards');
  const [serviceLayout, setServiceLayout] = useState<'cards' | 'list' | 'carousel' | 'luxury_catalog'>('cards');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<CreatedBusiness | null>(null);
  const [domain, setDomain] = useState('');
  const [domainSetup, setDomainSetup] = useState<DomainSetup | null>(null);
  const [domainMessage, setDomainMessage] = useState('');
  const [domainLoading, setDomainLoading] = useState(false);
  const [businesses, setBusinesses] = useState<BusinessOption[]>([]);
  const [selectedBusinessId, setSelectedBusinessId] = useState('');
  const [businessesMessage, setBusinessesMessage] = useState('');
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [deletionRequests, setDeletionRequests] = useState<DeletionRequest[]>([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminMessage, setAdminMessage] = useState('');
  const [businessSearch, setBusinessSearch] = useState('');
  const [businessStatusFilter, setBusinessStatusFilter] = useState('all');
  const [subscriptionFilter, setSubscriptionFilter] = useState('all');
  const [emailVerificationFilter, setEmailVerificationFilter] = useState('all');

  useEffect(() => {
    let cancelled = false;
    let verifying = false;
    const clearProtectedState = () => {
      setBusinesses([]);
      setOverview(null);
      setDeletionRequests([]);
      setCreated(null);
      setSelectedBusinessId('');
      setDomainSetup(null);
      setName('');
      setSlug('');
      setPhone('');
      setWhatsappNumber('');
      setEmail('');
      setDomain('');
      setDomainMessage('');
      setBusinessSearch('');
      setBusinessStatusFilter('all');
      setSubscriptionFilter('all');
      setEmailVerificationFilter('all');
      setError('');
      setAdminMessage('');
      setBusinessesMessage('');
    };
    async function verifyPlatformAdmin() {
      if (verifying || cancelled) return;
      verifying = true;
      setAccessState('checking');
      try {
        const response = await fetch('/api/auth/me', { cache: 'no-store', credentials: 'same-origin', headers: { 'Cache-Control': 'no-cache' } });
        if (!response.ok) {
          clearProtectedState();
          if (!cancelled) window.location.replace('/login?next=%2Fplatform-admin');
          return;
        }
        const data = await response.json().catch(() => null);
        if (data?.user?.role !== 'super_admin') {
          clearProtectedState();
          if (!cancelled) window.location.replace('/account');
          return;
        }
        if (!cancelled) setAccessState('allowed');
      } catch {
        clearProtectedState();
        if (!cancelled) window.location.replace('/login?next=%2Fplatform-admin');
      } finally {
        verifying = false;
      }
    }
    const endSession = () => {
      setAccessState('checking');
      clearProtectedState();
      window.location.replace('/login');
    };
    const handlePageShow = () => { void verifyPlatformAdmin(); };
    const handleStorage = (event: StorageEvent) => { if (event.key === 'btime-session-ended') endSession(); };
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('btime-auth') : null;
    const handleBroadcast = (event: MessageEvent) => { if (event.data === 'session-ended') endSession(); };
    window.addEventListener('pageshow', handlePageShow);
    window.addEventListener('storage', handleStorage);
    channel?.addEventListener('message', handleBroadcast);
    void verifyPlatformAdmin();
    return () => {
      cancelled = true;
      window.removeEventListener('pageshow', handlePageShow);
      window.removeEventListener('storage', handleStorage);
      channel?.removeEventListener('message', handleBroadcast);
      channel?.close();
    };
  }, []);
  const targetBusinessId = selectedBusinessId || created?.id;
  const targetBusiness = businesses.find((business) => business.id === targetBusinessId);
  const filteredBusinesses = businesses.filter((business) => {
    const term = businessSearch.trim().toLocaleLowerCase('he-IL');
    const matchesSearch = !term || [business.name, business.slug, business.owner_email, business.owner_phone, business.email, business.phone].some((value) => value?.toLocaleLowerCase('he-IL').includes(term));
    const matchesStatus = businessStatusFilter === 'all' || business.status === businessStatusFilter;
    const matchesSubscription = subscriptionFilter === 'all' || (subscriptionFilter === 'none' ? !business.subscription_status : business.subscription_status === subscriptionFilter);
    const matchesVerification = emailVerificationFilter === 'all' || (emailVerificationFilter === 'verified' ? Boolean(business.owner_email) && business.owner_email_verified === true : emailVerificationFilter === 'unverified' ? Boolean(business.owner_email) && business.owner_email_verified !== true : emailVerificationFilter === 'no_owner' ? !business.owner_email : false);
    return matchesSearch && matchesStatus && matchesSubscription && matchesVerification;
  });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError('');
    setCreated(null);
    setDomainSetup(null);
    setDomainMessage('');
    try {
      const response = await fetch('/api/admin/businesses', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name,
          slug,
          ...(phone.trim() ? { phone: phone.trim() } : {}),
          ...(whatsappNumber.trim() ? { whatsapp_number: whatsappNumber.trim() } : {}),
          ...(email.trim() ? { email: email.trim() } : {}),
          branding: { colors: BRAND_PALETTES[palette].colors, storefront_theme: storefrontTheme, hero_gallery_layout: galleryLayout, product_layout: productLayout, service_layout: serviceLayout },
        }),
        cache: 'no-store',
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const messages: Record<string, string> = {
          unauthorized: 'נדרשת התחברות לחשבון סופר אדמין מורשה.',
          admin_not_configured: 'שירות ניהול הפלטפורמה אינו מוגדר בשרת.',
          provisioning_not_configured: 'חסרות הגדרות מסד הנתונים או כתובת האתר בשרת.',
          slug_already_exists: 'כתובת האתר הזו כבר תפוסה.',
          invalid_il_phone: 'יש להזין מספר טלפון ישראלי תקין.',
          business_provisioning_failed: 'יצירת העסק נכשלה. בדוק את לוג השרת לפני ניסיון חוזר.',
        };
        throw new Error(messages[data?.error] ?? data?.message ?? 'לא ניתן ליצור את העסק כרגע.');
      }
      setCreated(data as CreatedBusiness);
      setSelectedBusinessId((data as CreatedBusiness).id);
      setBusinesses((current) => {
        const item = data as CreatedBusiness;
        const existing = current.find((business) => business.id === item.id);
        const option: BusinessOption = { id: item.id, name: item.name, slug: item.slug, status: item.status, domains: existing?.domains ?? [] };
        return existing ? current.map((business) => business.id === item.id ? option : business) : [option, ...current];
      });
      setName('');
      setSlug('');
      setPhone('');
      setWhatsappNumber('');
      setEmail('');
      setPalette('natural');
      setStorefrontTheme('soft');
      setGalleryLayout('slider');
      setProductLayout('cards');
      setServiceLayout('cards');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'אירעה שגיאה לא צפויה.');
    } finally {
      setLoading(false);
    }
  }


  const loadAdminData = useCallback(async () => {
    setAdminLoading(true);
    setAdminMessage('');
    try {
      const [overviewResponse, businessesResponse, deletionResponse] = await Promise.all([
        fetch('/api/admin/overview', { cache: 'no-store' }),
        fetch('/api/admin/businesses', { cache: 'no-store' }),
        fetch('/api/admin/deletion-requests', { cache: 'no-store' }),
      ]);
      const [overviewData, businessesData, deletionData] = await Promise.all([
        overviewResponse.json().catch(() => null),
        businessesResponse.json().catch(() => null),
        deletionResponse.json().catch(() => null),
      ]);
      if (!overviewResponse.ok || !businessesResponse.ok || !deletionResponse.ok) {
        throw new Error('לא ניתן לטעון את נתוני הניהול. התחבר באמצעות חשבון שהוגדר במסד הנתונים בתפקיד super_admin.');
      }
      setOverview(overviewData as AdminOverview);
      setBusinesses((businessesData?.businesses ?? []) as BusinessOption[]);
      setDeletionRequests((deletionData?.requests ?? []) as DeletionRequest[]);
      setAdminMessage('נתוני המערכת עודכנו.');
    } catch (err) {
      setAdminMessage(err instanceof Error ? err.message : 'טעינת נתוני הניהול נכשלה.');
    } finally {
      setAdminLoading(false);
    }
  }, []);

  useEffect(() => { if (accessState === 'allowed') void loadAdminData(); }, [accessState, loadAdminData]);

  async function updateBusinessStatus(id: string, status: string) {
    setAdminLoading(true); setAdminMessage('');
    try {
      const response = await fetch(`/api/admin/businesses/${id}/status`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status }), cache: 'no-store',
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.message ?? 'לא ניתן לעדכן את סטטוס העסק.');
      setBusinesses(current => current.map(item => item.id === id ? { ...item, status: data.status } : item));
      setAdminMessage('סטטוס העסק עודכן.');
    } catch (err) { setAdminMessage(err instanceof Error ? err.message : 'עדכון נכשל.'); }
    finally { setAdminLoading(false); }
  }

  async function updateSubscription(id: string, status: string) {
    setAdminLoading(true); setAdminMessage('');
    try {
      const body = status === 'trialing'
        ? { status, trial_ends_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() }
        : { status };
      const response = await fetch(`/api/admin/businesses/${id}/subscription`, {
        method: 'PATCH', headers: { 'content-type': 'application/json', },
        body: JSON.stringify(body), cache: 'no-store',
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.message ?? 'לא ניתן לעדכן את המנוי.');
      setBusinesses(current => current.map(item => item.id === id ? { ...item, subscription_status: data.status, trial_ends_at: data.trial_ends_at, current_period_ends_at: data.current_period_ends_at } : item));
      setAdminMessage('סטטוס המנוי עודכן.');
      await loadAdminData();
    } catch (err) { setAdminMessage(err instanceof Error ? err.message : 'עדכון נכשל.'); }
    finally { setAdminLoading(false); }
  }

  async function verifyOwnerEmail(id: string) {
    if (!window.confirm('לאמת ידנית את כתובת המייל של בעל העסק? יש לבצע זאת רק לאחר בדיקת זהותו או אישורו בערוץ אחר.')) return;
    setAdminLoading(true); setAdminMessage('');
    try {
      const response = await fetch(`/api/admin/businesses/${id}/owner-email-verification`, {
        method: 'PATCH', cache: 'no-store',
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.message ?? 'לא ניתן לאמת את כתובת המייל.');
      setBusinesses(current => current.map(item => item.id === id ? { ...item, owner_email_verified: true } : item));
      setAdminMessage('כתובת המייל של בעל העסק סומנה כמאומתת ידנית. הפעולה תועדה.');
    } catch (err) { setAdminMessage(err instanceof Error ? err.message : 'האימות נכשל.'); }
    finally { setAdminLoading(false); }
  }

  async function requestBusinessDeletion(id: string) {
    const business = businesses.find((item) => item.id === id);
    if (!business) return;
    if (!window.confirm(`לפתוח בקשת מחיקה עבור העסק "${business.name}"? העסק לא יימחק מיד. תחילה תידרש הקפאה ואישור, ולאחר מכן ביצוע מחיקה מלאה של ה-DB והמדיה.`)) return;
    setAdminLoading(true); setAdminMessage('');
    try {
      const response = await fetch(`/api/admin/businesses/${id}/deletion-request`, {
        method: 'POST', headers: { }, cache: 'no-store',
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.message ?? 'לא ניתן לפתוח בקשת מחיקה לעסק.');
      setAdminMessage(data?.message ?? 'בקשת המחיקה נפתחה.');
      await loadAdminData();
    } catch (err) { setAdminMessage(err instanceof Error ? err.message : 'פתיחת בקשת המחיקה נכשלה.'); }
    finally { setAdminLoading(false); }
  }

  async function executeDeletion(id: string) {
    const backupReference = window.prompt('לפני מחיקה יש ליצור גיבוי למסד הנתונים ב-Railway, לוודא שניתן לשחזר/לקרוא אותו, ולהזין כאן מזהה גיבוי או אסמכתה (לפחות 8 תווים):');
    if (!backupReference || backupReference.trim().length < 8) {
      setAdminMessage('המחיקה בוטלה. נדרשת אסמכתה לגיבוי מאומת.');
      return;
    }
    if (!window.confirm('אני מאשר/ת שיצרתי גיבוי Railway למסד הנתונים הייעודי, בדקתי שהוא תקין ושניתן לשחזר ממנו, והאסמכתה שהזנתי נכונה. המחיקה בלתי הפיכה. להמשיך?')) return;
    setAdminLoading(true); setAdminMessage('');
    try {
      const response = await fetch(`/api/admin/deletion-requests/${id}/execute`, {
        method: 'POST', headers: { 'content-type': 'application/json', },
        body: JSON.stringify({ backupVerified: true, backupReference: backupReference.trim() }), cache: 'no-store',
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.message ?? 'המחיקה נכשלה. הבקשה נשארה מאושרת וניתן לנסות שוב לאחר בדיקה.');
      setAdminMessage(data?.message ?? 'העסק נמחק.');
      await loadAdminData();
    } catch (err) { setAdminMessage(err instanceof Error ? err.message : 'המחיקה נכשלה.'); }
    finally { setAdminLoading(false); }
  }

  async function reviewDeletion(id: string, decision: 'approve' | 'reject') {
    const prompt = decision === 'approve'
      ? 'לאשר את בקשת המחיקה? העסק ייחסם ויועבר לשלב מחיקה מבוקר.'
      : 'לדחות את בקשת המחיקה?';
    if (!window.confirm(prompt)) return;
    setAdminLoading(true); setAdminMessage('');
    try {
      const response = await fetch(`/api/admin/deletion-requests/${id}/review`, {
        method: 'PATCH', headers: { 'content-type': 'application/json', },
        body: JSON.stringify({ decision }), cache: 'no-store',
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.message ?? 'לא ניתן לעדכן את בקשת המחיקה.');
      setDeletionRequests(current => current.filter(item => item.id !== id));
      if (decision === 'approve') setBusinesses(current => current.map(item => item.id === data.tenant_id ? { ...item, status: 'suspended' } : item));
      setAdminMessage(decision === 'approve' ? 'הבקשה אושרה והעסק הוקפא. המחיקה הפיזית תתבצע בשלב מאובטח נפרד.' : 'בקשת המחיקה נדחתה.');
      await loadAdminData();
    } catch (err) { setAdminMessage(err instanceof Error ? err.message : 'עדכון נכשל.'); }
    finally { setAdminLoading(false); }
  }

  if (accessState !== 'allowed') {
    return (
      <main dir="rtl" className="flex min-h-screen items-center justify-center bg-slate-50 px-4 text-slate-700">
        <p role="status" aria-live="polite">בודק הרשאות גישה לממשק ניהול הפלטפורמה…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900 sm:px-6">
      <div className="mx-auto max-w-2xl">
        <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <p className="mb-2 text-sm font-semibold text-blue-700">ניהול פלטפורמה</p>
          <h1 className="text-3xl font-bold tracking-tight">יצירת עסק חדש</h1>
          <p className="mt-3 leading-7 text-slate-600">
            כל עסק חדש יקבל מסד PostgreSQL נפרד בתוך שירות Railway הקיים, אתר ציבורי וקישור ניהול פרטי.
          </p>
          <button type="button" onClick={async () => {
            await fetch('/api/auth/logout', { method: 'POST', cache: 'no-store', credentials: 'same-origin' }).catch(() => {});
            try { window.localStorage.setItem('btime-session-ended', String(Date.now())); } catch {}
            try {
              const channel = new BroadcastChannel('btime-auth');
              channel.postMessage('session-ended');
              channel.close();
            } catch {}
            window.location.replace('/login');
          }} className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold">התנתקות</button>
        </header>

        <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="text-lg font-bold">לוח בקרה</h2><p className="mt-1 text-sm text-slate-600">ניהול עסקים, מנויים ובקשות מחיקה.</p></div>
            <div className="flex flex-wrap gap-2">
              <Link href="/register" className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold">הרשמת בעל עסק</Link>
              <button type="button" onClick={loadAdminData} disabled={adminLoading} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{adminLoading ? 'טוען…' : 'טעינת נתוני מערכת'}</button>
            </div>
          </div>
          {adminMessage && <p role="status" className="mt-3 text-sm text-slate-700">{adminMessage}</p>}
          {overview && <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[
              ['עסקים במערכת', overview.total_businesses],
              ['עסקים פעילים', overview.active_businesses],
              ['עסקים חסומים', overview.suspended_businesses],
              ['בתקופת ניסיון', overview.trialing_subscriptions],
              ['מנויים פעילים', overview.paid_subscriptions],
              ['בקשות מחיקה', overview.pending_deletion_requests],
            ].map(([label, value]) => <div key={String(label)} className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-2xl font-bold tabular-nums">{value}</p></div>)}
          </div>}
        </section>

        {businesses.length > 0 && <section className="mb-6 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-bold">עסקים ({filteredBusinesses.length} מתוך {businesses.length})</h2><button type="button" onClick={loadAdminData} disabled={adminLoading} className="text-sm font-semibold text-blue-700 underline">רענון הרשימה</button></div>
          <div className="grid gap-2 sm:grid-cols-4">
            <input aria-label="חיפוש עסקים" value={businessSearch} onChange={e=>setBusinessSearch(e.target.value)} placeholder="חיפוש לפי עסק, כתובת, מייל או טלפון" className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm sm:col-span-4" />
            <select aria-label="סינון לפי סטטוס עסק" value={businessStatusFilter} onChange={e=>setBusinessStatusFilter(e.target.value)} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"><option value="all">כל מצבי העסק</option><option value="active">פעיל</option><option value="suspended">חסום</option><option value="archived">בארכיון</option></select>
            <select aria-label="סינון לפי מנוי" value={subscriptionFilter} onChange={e=>setSubscriptionFilter(e.target.value)} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"><option value="all">כל מצבי המנוי</option><option value="trialing">תקופת ניסיון</option><option value="active">מנוי פעיל</option><option value="past_due">תשלום באיחור</option><option value="canceled">בוטל</option><option value="suspended">מושהה</option><option value="none">ללא מנוי</option></select>
            <select aria-label="סינון לפי אימות מייל" value={emailVerificationFilter} onChange={e=>setEmailVerificationFilter(e.target.value)} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"><option value="all">כל מצבי הבעלות</option><option value="verified">מייל בעלים מאומת</option><option value="unverified">מייל בעלים לא אומת</option><option value="no_owner">ללא חשבון בעלים</option></select>
            <button type="button" onClick={()=>{setBusinessSearch('');setBusinessStatusFilter('all');setSubscriptionFilter('all');setEmailVerificationFilter('all');}} className="rounded-xl border border-slate-300 px-3 py-2 text-sm">ניקוי סינון</button>
          </div>
          {filteredBusinesses.length===0 && <p className="rounded-xl bg-white p-4 text-sm text-slate-500">לא נמצאו עסקים התואמים לסינון.</p>}
          {filteredBusinesses.map(business => <article key={business.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><h3 className="font-bold">{business.name}</h3><p className="mt-1 text-xs text-slate-500" dir="ltr">/biz/{business.slug}</p>
                <p className="mt-1 text-xs text-slate-500">{business.owner_email ?? business.email ?? 'ללא מייל בעלים'} · {business.owner_phone ?? business.phone ?? 'ללא טלפון'}</p>
                <p className="mt-1 text-xs">{business.owner_email ? <>אימות מייל בעלים: <span className={business.owner_email_verified?'text-emerald-700':'text-amber-700'}>{business.owner_email_verified?'מאומת':'לא אומת'}</span></> : <span className="text-slate-500">לעסק אין חשבון בעלים משויך</span>}</p></div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold">{business.status === 'active' ? 'פעיל' : business.status === 'suspended' ? 'חסום' : business.status}</span>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-semibold text-slate-600">סטטוס גישה
                <select value={business.status} disabled={adminLoading} onChange={e=>updateBusinessStatus(business.id,e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm text-slate-900">
                  <option value="active">פעיל</option><option value="suspended">חסום</option><option value="archived">בארכיון</option>
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-600">מנוי
                <span className="mt-1 block font-normal text-slate-500">אפשר לאשר מנוי גם כשהמייל עדיין לא אומת.</span>
                <select value={business.subscription_status ?? 'none'} disabled={adminLoading} onChange={e=>updateSubscription(business.id,e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm text-slate-900">
                  <option value="none" disabled>ללא מנוי קיים</option><option value="trialing">ניסיון ל-30 יום</option><option value="active">פעיל</option><option value="past_due">תשלום באיחור</option><option value="canceled">בוטל</option><option value="suspended">מושהה</option>
                </select>
              </label>
            </div>
            {!business.owner_email_verified && business.owner_email && <button type="button" disabled={adminLoading} onClick={()=>verifyOwnerEmail(business.id)} className="mt-3 rounded-lg border border-amber-300 px-3 py-2 text-xs font-semibold text-amber-900 disabled:opacity-50">אימות מייל ידני לאחר בדיקה</button>}
            <button type="button" disabled={adminLoading || deletionRequests.some((request) => request.tenant_id === business.id)} onClick={()=>requestBusinessDeletion(business.id)} className="mt-3 mr-2 rounded-lg border border-red-300 px-3 py-2 text-xs font-semibold text-red-800 disabled:opacity-50">פתיחת בקשת מחיקה מלאה</button>
            {business.trial_ends_at && <p className="mt-2 text-xs text-slate-500">סיום ניסיון: {new Date(business.trial_ends_at).toLocaleDateString('he-IL')}</p>}
            {business.domains.length > 0 && <p className="mt-2 break-all text-xs text-slate-500">{business.domains.map(d=>d.domain).join(' · ')}</p>}
          </article>)}
        </section>}

        {deletionRequests.length > 0 && <section className="mb-6 rounded-2xl border border-amber-200 bg-white p-5 shadow-sm">
          <h2 className="font-bold">בקשות מחיקה ממתינות ({deletionRequests.length})</h2>
          <div className="mt-3 space-y-3">
            {deletionRequests.map(request => <div key={request.id} className="rounded-xl bg-amber-50 p-3">
              <p className="font-semibold">{request.business_name}</p><p className="mt-1 text-xs text-slate-600">{request.owner_email ?? 'ללא חשבון בעלים'}{request.owner_phone ? ` · ${request.owner_phone}` : ''}</p>
              {request.reason && <p className="mt-2 text-sm">{request.reason}</p>}
              <p className="mt-2 text-xs font-semibold text-amber-900">{request.status === 'approved' ? 'אושרה — העסק חסום וממתין למחיקה מלאה' : 'ממתינה לאישור'}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {request.status === 'approved' ? <>
                  <button type="button" disabled={adminLoading} onClick={()=>executeDeletion(request.id)} className="rounded-lg bg-red-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">ביצוע מחיקה מלאה</button>
                </> : <>
                  <button type="button" disabled={adminLoading} onClick={()=>reviewDeletion(request.id,'approve')} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">אישור והקפאת העסק</button>
                  <button type="button" disabled={adminLoading} onClick={()=>reviewDeletion(request.id,'reject')} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold disabled:opacity-50">דחיית בקשה</button>
                </>}
              </div>
            </div>)}
          </div>
        </section>}

        <form onSubmit={submit} className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <div>
            <label htmlFor="name" className="mb-2 block text-sm font-semibold">שם העסק *</label>
            <input id="name" required minLength={2} maxLength={120} value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-3 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
              placeholder="למשל: מרפאת דנה" />
          </div>

          <div>
            <label htmlFor="slug" className="mb-2 block text-sm font-semibold">כתובת ייחודית באנגלית *</label>
            <div className="flex items-center gap-2">
              <input id="slug" required minLength={2} maxLength={63} pattern="[a-z0-9]+(-[a-z0-9]+)*"
                value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())}
                className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-3 text-left outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                placeholder="clinic-dana" dir="ltr" />
              <span className="text-xs text-slate-500">/biz/</span>
            </div>
          </div>

          <PalettePicker value={palette} onChange={setPalette} />
          <StorefrontDesignPicker theme={storefrontTheme} onThemeChange={setStorefrontTheme} galleryLayout={galleryLayout} onGalleryLayoutChange={setGalleryLayout} productLayout={productLayout} onProductLayoutChange={setProductLayout} serviceLayout={serviceLayout} onServiceLayoutChange={setServiceLayout} />

          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label htmlFor="phone" className="mb-2 block text-sm font-semibold">טלפון עסק</label>
              <input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-3 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                placeholder="050-1234567" dir="ltr" />
            </div>
            <div>
              <label htmlFor="whatsapp" className="mb-2 block text-sm font-semibold">WhatsApp עסק</label>
              <input id="whatsapp" type="tel" value={whatsappNumber} onChange={(e) => setWhatsappNumber(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-3 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                placeholder="050-1234567" dir="ltr" />
            </div>
          </div>

          <div>
            <label htmlFor="email" className="mb-2 block text-sm font-semibold">דוא״ל העסק</label>
            <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-3 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
              placeholder="hello@example.co.il" dir="ltr" />
          </div>

          {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}

          <button type="submit" disabled={loading}
            className="w-full rounded-xl bg-blue-700 px-4 py-3 font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60">
            {loading ? 'יוצר מסד ומקים את העסק…' : 'יצירת העסק והקישורים'}
          </button>
        </form>

        {created && (
          <section aria-live="polite" className="mt-6 space-y-4 rounded-2xl border border-emerald-200 bg-white p-5 sm:p-7">
            <h2 className="text-xl font-bold text-emerald-800">העסק נוצר בהצלחה</h2>
            <p className="text-sm text-slate-600">מסד ייעודי: <code dir="ltr">{created.database}</code></p>
            <div>
              <p className="mb-1 text-sm font-semibold">אתר ציבורי</p>
              <a className="break-all text-blue-700 underline" href={created.public_url} target="_blank" rel="noreferrer">{created.public_url}</a>
            </div>
            <div>
              <p className="mb-1 text-sm font-semibold">קישור ניהול למוכר — יש לשמור ולמסור לבעל העסק</p>
              <a className="break-all text-blue-700 underline" href={created.management_url} target="_blank" rel="noreferrer">{created.management_url}</a>
              <p className="mt-2 text-xs leading-5 text-amber-800">הקישור מכיל הרשאת גישה פרטית. העבר אותו לבעל העסק בערוץ מאובטח ואל תפרסם אותו.</p>
            </div>
          </section>
        )}


        <section className="mt-6 space-y-3 rounded-2xl border border-slate-200 bg-white p-5 sm:p-7">
          <h2 className="text-lg font-bold">בחירת עסק קיים</h2>
          <p className="text-sm text-slate-600">אם האתר כבר הוקם, אפשר לבחור אותו כאן — אין צורך ליצור עסק נוסף.</p>
          <button type="button" disabled={domainLoading} onClick={async () => {
            setDomainLoading(true); setBusinessesMessage('');
            try {
              const response = await fetch('/api/admin/businesses', { headers: { }, cache: 'no-store' });
              const data = await response.json().catch(() => null);
              if (!response.ok) throw new Error(data?.message ?? 'לא ניתן לטעון את רשימת העסקים.');
              setBusinesses((data?.businesses ?? []) as BusinessOption[]);
              setBusinessesMessage(`נטענו ${(data?.businesses ?? []).length} עסקים.`);
            } catch (err) { setBusinessesMessage(err instanceof Error ? err.message : 'אירעה שגיאה.'); }
            finally { setDomainLoading(false); }
          }} className="rounded-xl border border-slate-300 px-4 py-2 font-semibold disabled:opacity-60">טעינת עסקים קיימים</button>
          {businesses.length > 0 && <select aria-label="בחירת עסק קיים" value={selectedBusinessId} onChange={(e) => { setSelectedBusinessId(e.target.value); setDomainSetup(null); setDomainMessage(''); }} className="w-full rounded-xl border border-slate-300 px-3 py-3">
            <option value="">בחר עסק…</option>
            {businesses.map((business) => <option key={business.id} value={business.id}>{business.name} — /biz/{business.slug}</option>)}
          </select>}
          {businessesMessage && <p className="text-sm text-slate-600">{businessesMessage}</p>}
          {targetBusinessId && targetBusiness && <div className="space-y-1 text-sm"><p className="font-semibold">דומיינים רשומים:</p>{targetBusiness.domains.length ? targetBusiness.domains.map((item) => <p key={item.domain} dir="ltr">{item.domain} — {item.is_verified ? 'מאומת' : 'ממתין לאימות'}</p>) : <p className="text-slate-500">עדיין אין דומיין לעסק הזה.</p>}</div>}
        </section>

        {targetBusinessId && (
          <section className="mt-6 space-y-4 rounded-2xl border border-blue-200 bg-white p-5 sm:p-7">
            <h2 className="text-xl font-bold">חיבור דומיין של העסק</h2>
            <p className="text-sm leading-6 text-slate-600">
              קודם רושמים את הדומיין ומאמתים בעלות באמצעות רשומת DNS מסוג TXT. לאחר מכן צריך לחבר את הדומיין בפרויקט Vercel ולהגדיר את רשומת ה-DNS שלו.
            </p>
            <form className="flex flex-col gap-3 sm:flex-row" onSubmit={async (event) => {
              event.preventDefault();
              setDomainLoading(true);
              setDomainMessage('');
              setDomainSetup(null);
              try {
                const response = await fetch(`/api/admin/businesses/${targetBusinessId}/domains`, {
                  method: 'POST',
                  headers: { 'content-type': 'application/json', },
                  body: JSON.stringify({ domain: domain.trim() }),
                  cache: 'no-store',
                });
                const data = await response.json().catch(() => null);
                if (!response.ok) {
                  const messages: Record<string, string> = {
                    domain_already_registered: 'הדומיין כבר רשום במערכת.',
                    invalid_domain: 'יש להזין דומיין תקין בלבד, ללא https:// או נתיב.',
                    business_not_found: 'העסק לא נמצא במערכת.',
                  };
                  throw new Error(messages[data?.error] ?? data?.message ?? 'לא ניתן לרשום את הדומיין.');
                }
                setDomainSetup(data as DomainSetup);
                setBusinesses((current) => current.map((business) => {
                  if (business.id !== targetBusinessId) return business;
                  const item = { domain: data.domain as string, is_verified: Boolean(data.verified), is_primary: false };
                  const domains = business.domains.some((existing) => existing.domain === item.domain)
                    ? business.domains.map((existing) => existing.domain === item.domain ? { ...existing, is_verified: item.is_verified } : existing)
                    : [...business.domains, item];
                  return { ...business, domains };
                }));
                setDomain('');
              } catch (err) {
                setDomainMessage(err instanceof Error ? err.message : 'אירעה שגיאה.');
              } finally {
                setDomainLoading(false);
              }
            }}>
              <input aria-label="דומיין העסק" required value={domain} onChange={(e) => setDomain(e.target.value)}
                className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-3 text-left outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                placeholder="www.example.co.il" dir="ltr" />
              <button type="submit" disabled={domainLoading}
                className="rounded-xl bg-blue-700 px-4 py-3 font-semibold text-white disabled:opacity-60">
                {domainLoading ? 'רושם…' : 'רישום דומיין'}
              </button>
            </form>
            {domainMessage && <p role="alert" className="text-sm text-red-700">{domainMessage}</p>}
            {domainSetup && (
              <div className="space-y-3 rounded-xl bg-slate-50 p-4">
                <p className="font-semibold">הוסף אצל ספק הדומיין את רשומת ה-TXT הבאה:</p>
                <div><p className="text-xs text-slate-500">שם / Host</p><code className="block break-all" dir="ltr">{domainSetup.verification.name}</code></div>
                <div><p className="text-xs text-slate-500">ערך / Value</p><code className="block break-all" dir="ltr">{domainSetup.verification.value}</code></div>
                <p className="text-sm leading-6 text-slate-600">לאחר שמירת הרשומה והפצת ה-DNS, לחץ על בדיקת אימות. האימות עשוי לקחת זמן בהתאם לספק הדומיין.</p>
                <button type="button" disabled={domainLoading} onClick={async () => {
                  setDomainLoading(true);
                  setDomainMessage('');
                  try {
                    const response = await fetch(`/api/admin/businesses/${targetBusinessId}/domains/${encodeURIComponent(domainSetup.domain)}/verify`, {
                      method: 'POST',
                      headers: { },
                      cache: 'no-store',
                    });
                    const data = await response.json().catch(() => null);
                    if (!response.ok) {
                      const messages: Record<string, string> = {
                        dns_verification_not_found: 'רשומת האימות עדיין לא נמצאה. בדוק את שם הרשומה והערך ונסה שוב בהמשך.',
                      };
                      throw new Error(messages[data?.error] ?? data?.message ?? 'האימות נכשל.');
                    }
                    setDomainSetup({ ...domainSetup, verified: true });
                    setBusinesses((current) => current.map((business) => business.id !== targetBusinessId ? business : ({
                      ...business,
                      domains: business.domains.map((item) => item.domain === domainSetup.domain ? { ...item, is_verified: true } : item),
                    })));
                    setDomainMessage('הדומיין אומת. עדיין צריך לחבר אותו בפרויקט Vercel ולהגדיר DNS לפני שהוא יגיש את האתר.');
                  } catch (err) {
                    setDomainMessage(err instanceof Error ? err.message : 'אירעה שגיאה.');
                  } finally {
                    setDomainLoading(false);
                  }
                }} className="rounded-xl border border-blue-700 px-4 py-2 font-semibold text-blue-800 disabled:opacity-60">
                  {domainLoading ? 'בודק…' : domainSetup.verified ? 'הדומיין אומת' : 'בדיקת אימות DNS'}
                </button>
                {domainMessage && <p role="status" className="text-sm text-slate-700">{domainMessage}</p>}
              </div>
            )}
          </section>
        )}

        <p className="mt-6 text-center text-xs text-slate-500">הגישה לניהול הפלטפורמה זמינה רק לחשבון מאומת שתפקידו super_admin.</p>
      </div>
    </main>
  );
}
