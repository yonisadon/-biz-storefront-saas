'use client';

import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import Link from 'next/link';

type MarketingContent = {
  heroEyebrow: string;
  heroTitle: string;
  heroDescription: string;
  announcementEnabled: boolean;
  announcementTitle: string;
  announcementBody: string;
  heroImageUrl: string | null;
  screenshotUrls: string[];
};
type OwnerContent = { welcomeTitle: string; welcomeMessage: string };
type Business = { id: string; name: string; slug: string; owner_email?: string | null };
type Message = {
  id: string; title: string; body: string; channel: string; category: string; status: string;
  created_at: string; recipient_count: number; email_accepted_count: number; email_failed_count: number;
  email_skipped_count: number; in_app_read_count: number;
};

const DEFAULT_MARKETING: MarketingContent = {
  heroEyebrow: 'העסק שלך. פשוט יותר.',
  heroTitle: 'כל מה שהעסק שלך צריך כדי להיות נוכח ולהתנהל.',
  heroDescription: 'אתר עסקי שאפשר לשתף עם לקוחות, יחד עם כלים נוחים להצגת מוצרים ושירותים, לקבלת פניות ולניהול תורים — בלי להסתבך עם בניית אתר.',
  announcementEnabled: false, announcementTitle: '', announcementBody: '', heroImageUrl: null, screenshotUrls: [],
};
const DEFAULT_OWNER: OwnerContent = {
  welcomeTitle: 'ברוכים הבאים לאזור האישי של BTime',
  welcomeMessage: 'מכאן אפשר להיכנס לניהול העסק, לעדכן פרטים ולעקוב אחר מצב החשבון והמנוי.',
};

function errorMessage(data: any, fallback: string) {
  const messages: Record<string, string> = {
    unauthorized: 'אין הרשאה לבצע פעולה זו. יש להתחבר מחדש לחשבון סופר אדמין.',
    platform_content_not_migrated: 'מסד הנתונים המרכזי עדיין לא עודכן. נדרשת מיגרציית Registry לפני ניהול התוכן.',
    email_service_not_configured: 'שירות הדוא״ל אינו מוגדר כרגע בשרת.',
    duplicate_message_submission: 'הבקשה הזו כבר נשלחה או נמצאת בתהליך. בדוק את היסטוריית השליחות.',
    no_message_recipients: 'לא נמצאו בעלי עסקים מתאימים לקהל שנבחר.',
  };
  return messages[data?.error] ?? data?.message ?? fallback;
}

export default function PlatformAdminContent() {
  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [marketing, setMarketing] = useState<MarketingContent>(DEFAULT_MARKETING);
  const [owner, setOwner] = useState<OwnerContent>(DEFAULT_OWNER);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [history, setHistory] = useState<Message[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [channel, setChannel] = useState<'in_app' | 'email' | 'both'>('in_app');
  const [category, setCategory] = useState<'service' | 'marketing'>('service');
  const [audience, setAudience] = useState<'all' | 'selected'>('all');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [requestKey, setRequestKey] = useState('');

  async function loadData() {
    setLoading(true);
    setError('');
    try {
      const authResponse = await fetch('/api/auth/me', { cache: 'no-store', credentials: 'same-origin' });
      const authData = await authResponse.json().catch(() => null);
      if (!authResponse.ok || authData?.user?.role !== 'super_admin') {
        window.location.replace('/login?next=%2Fplatform-admin%2Fcontent');
        return;
      }
      setAllowed(true);
      const [marketingResponse, ownerResponse, businessResponse, historyResponse] = await Promise.all([
        fetch('/api/admin/platform-content/marketing_page', { cache: 'no-store' }),
        fetch('/api/admin/platform-content/owner_dashboard', { cache: 'no-store' }),
        fetch('/api/admin/businesses', { cache: 'no-store' }),
        fetch('/api/admin/messages', { cache: 'no-store' }),
      ]);
      const [marketingData, ownerData, businessData, historyData] = await Promise.all([
        marketingResponse.json().catch(() => null), ownerResponse.json().catch(() => null),
        businessResponse.json().catch(() => null), historyResponse.json().catch(() => null),
      ]);
      if (!marketingResponse.ok || !ownerResponse.ok || !businessResponse.ok || !historyResponse.ok) {
        throw new Error(errorMessage(marketingData ?? ownerData ?? historyData, 'לא ניתן לטעון את נתוני התוכן והתקשורת.'));
      }
      setMarketing({ ...DEFAULT_MARKETING, ...(marketingData?.content ?? {}) });
      setOwner({ ...DEFAULT_OWNER, ...(ownerData?.content ?? {}) });
      setBusinesses((businessData?.businesses ?? []) as Business[]);
      setHistory((historyData?.messages ?? []) as Message[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'טעינת הנתונים נכשלה.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadData(); }, []);

  function updateMarketing<K extends keyof MarketingContent>(key: K, value: MarketingContent[K]) {
    setMarketing(current => ({ ...current, [key]: value }));
  }

  async function uploadImage(event: ChangeEvent<HTMLInputElement>, target: 'hero' | 'screenshot') {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setSaving(true); setError(''); setMessage('');
    try {
      const form = new FormData();
      form.append('file', file);
      const response = await fetch('/api/admin/platform-media', { method: 'POST', body: form, cache: 'no-store' });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.url) throw new Error(errorMessage(data, 'העלאת התמונה נכשלה.'));
      if (target === 'hero') updateMarketing('heroImageUrl', data.url);
      else updateMarketing('screenshotUrls', [...marketing.screenshotUrls, data.url].slice(0, 4));
      setMessage('התמונה הועלתה. כדי לפרסם אותה באתר יש לשמור את התוכן.');
    } catch (err) { setError(err instanceof Error ? err.message : 'העלאת התמונה נכשלה.'); }
    finally { setSaving(false); }
  }

  async function saveMarketing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/admin/platform-content/marketing_page', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(marketing), cache: 'no-store',
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorMessage(data, 'שמירת העמוד השיווקי נכשלה.'));
      setMarketing({ ...DEFAULT_MARKETING, ...data.content });
      setMessage('תוכן העמוד השיווקי נשמר.');
    } catch (err) { setError(err instanceof Error ? err.message : 'השמירה נכשלה.'); }
    finally { setSaving(false); }
  }

  async function saveOwner(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/admin/platform-content/owner_dashboard', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(owner), cache: 'no-store',
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorMessage(data, 'שמירת הודעת בעל העסק נכשלה.'));
      setOwner({ ...DEFAULT_OWNER, ...data.content });
      setMessage('תוכן מסך בעל העסק נשמר.');
    } catch (err) { setError(err instanceof Error ? err.message : 'השמירה נכשלה.'); }
    finally { setSaving(false); }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const recipients = audience === 'all' ? businesses.length : selectedIds.length;
    if (!recipients) { setError('יש לבחור לפחות עסק אחד.'); return; }
    const channelLabel = channel === 'in_app' ? 'הודעה בתוך המערכת' : channel === 'email' ? 'דוא״ל' : 'הודעה ודוא״ל';
    if (!window.confirm('לשלוח ' + channelLabel + ' לכ-' + recipients + ' עסקים?\n\nהשליחה תירשם בהיסטוריה ולא ניתן לבטל אותה.')) return;
    setSaving(true); setError(''); setMessage('');
    const key = requestKey || crypto.randomUUID();
    setRequestKey(key);
    try {
      const response = await fetch('/api/admin/messages', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          requestKey: key, title, body, channel, category,
          audience: audience === 'all' ? { type: 'all' } : { type: 'selected', businessIds: selectedIds },
        }),
        cache: 'no-store',
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorMessage(data, 'שליחת ההודעה נכשלה.'));
      setMessage('ההודעה נוצרה. נמענים: ' + data.recipient_count + '. דוא״ל שהתקבל אצל הספק: ' + data.email_accepted_count + ', כשלונות: ' + data.email_failed_count + '. קבלה אצל הספק אינה אישור מסירה או פתיחה.');
      setTitle(''); setBody(''); setRequestKey(''); setSelectedIds([]);
      await loadData();
    } catch (err) { setError(err instanceof Error ? err.message : 'שליחת ההודעה נכשלה.'); }
    finally { setSaving(false); }
  }

  if (loading) return <main className="btime-admin-content" dir="rtl"><p>טוען נתוני ניהול…</p></main>;
  if (!allowed) return null;

  return <main className="btime-admin-content" dir="rtl">
    <div className="bac-shell">
      <header className="bac-header">
        <div><Link href="/platform-admin" className="bac-back">← חזרה לניהול הפלטפורמה</Link><p className="bac-eyebrow">BTime / SUPER ADMIN</p><h1>תוכן ותקשורת</h1><p>ניהול התוכן שמופיע בפלטפורמה והודעות לבעלי העסקים.</p></div>
        <button type="button" onClick={()=>void loadData()} disabled={saving} className="bac-secondary">רענון נתונים</button>
      </header>
      {error&&<p role="alert" className="bac-alert bac-error">{error}</p>}
      {message&&<p role="status" className="bac-alert bac-success">{message}</p>}

      <section className="bac-section">
        <div className="bac-section-heading"><div><span>01 / MARKETING</span><h2>העמוד השיווקי</h2><p>התוכן מתפרסם בדומיין הפלטפורמה בלבד. תמונות שמעלים נשמרות באחסון הפלטפורמה, לא במסד של עסק.</p></div><a href="/" target="_blank" rel="noreferrer">צפייה בעמוד השיווקי ↗</a></div>
        <form onSubmit={saveMarketing} className="bac-form">
          <label>כותרת קטנה מעל הכותרת הראשית<input value={marketing.heroEyebrow} maxLength={100} onChange={e=>updateMarketing('heroEyebrow',e.target.value)} /></label>
          <label>כותרת ראשית<textarea required rows={2} maxLength={180} value={marketing.heroTitle} onChange={e=>updateMarketing('heroTitle',e.target.value)} /></label>
          <label>תיאור ראשי<textarea required rows={3} maxLength={700} value={marketing.heroDescription} onChange={e=>updateMarketing('heroDescription',e.target.value)} /></label>
          <div className="bac-media-field">
            <div><b>תמונה ראשית (אופציונלי)</b><p>JPEG, PNG או WebP עד 8MB. התמונה תעבור אופטימיזציה ותישמר כ-JPEG.</p></div>
            {marketing.heroImageUrl&&<div className="bac-image-preview"><img src={marketing.heroImageUrl} alt="תמונה ראשית נוכחית" /><button type="button" onClick={()=>updateMarketing('heroImageUrl',null)}>הסרת תמונה</button></div>}
            <label className="bac-upload">העלאת תמונה<input type="file" accept="image/jpeg,image/png,image/webp" disabled={saving} onChange={e=>void uploadImage(e,'hero')} /></label>
          </div>
          <div className="bac-media-field">
            <div><b>צילומי מסך להצגת המערכת</b><p>עד 4 תמונות. אפשר להעלות צילומי מסך אמיתיים של BTime.</p></div>
            <div className="bac-screenshot-previews">{marketing.screenshotUrls.map((url,index)=><figure key={url}><img src={url} alt={'צילום מסך '+(index+1)} /><button type="button" onClick={()=>updateMarketing('screenshotUrls',marketing.screenshotUrls.filter(item=>item!==url))}>הסרה</button></figure>)}</div>
            {marketing.screenshotUrls.length<4&&<label className="bac-upload">הוספת צילום מסך<input type="file" accept="image/jpeg,image/png,image/webp" disabled={saving} onChange={e=>void uploadImage(e,'screenshot')} /></label>}
          </div>
          <div className="bac-announcement-fields">
            <label className="bac-check"><input type="checkbox" checked={marketing.announcementEnabled} onChange={e=>updateMarketing('announcementEnabled',e.target.checked)} /> הצגת הודעה מתחלפת/עדכון בעמוד</label>
            <label>כותרת ההודעה<input value={marketing.announcementTitle} maxLength={100} onChange={e=>updateMarketing('announcementTitle',e.target.value)} /></label>
            <label>תוכן ההודעה<textarea rows={2} maxLength={500} value={marketing.announcementBody} onChange={e=>updateMarketing('announcementBody',e.target.value)} /></label>
          </div>
          <button type="submit" disabled={saving} className="bac-primary">{saving?'שומר…':'שמירת העמוד השיווקי'}</button>
        </form>
      </section>

      <section className="bac-section">
        <div className="bac-section-heading"><div><span>02 / OWNER HOME</span><h2>מסך הבית של בעל העסק</h2><p>הודעת פתיחה קצרה שמופיעה באזור החשבון לאחר התחברות.</p></div></div>
        <form onSubmit={saveOwner} className="bac-form bac-owner-form">
          <label>כותרת<input value={owner.welcomeTitle} maxLength={120} onChange={e=>setOwner(current=>({...current,welcomeTitle:e.target.value}))} /></label>
          <label>הודעה<textarea rows={3} maxLength={500} value={owner.welcomeMessage} onChange={e=>setOwner(current=>({...current,welcomeMessage:e.target.value}))} /></label>
          <button type="submit" disabled={saving} className="bac-primary">{saving?'שומר…':'שמירת מסך בעל העסק'}</button>
        </form>
      </section>

      <section className="bac-section">
        <div className="bac-section-heading"><div><span>03 / COMMUNICATION</span><h2>שליחת הודעה לבעלי עסקים</h2><p>הודעות בתוך המערכת, דוא״ל דרך Brevo או שניהם. SMS אינו נשלח.</p></div></div>
        <form onSubmit={sendMessage} className="bac-form">
          <label>כותרת ההודעה<input required maxLength={160} value={title} onChange={e=>setTitle(e.target.value)} /></label>
          <label>תוכן ההודעה<textarea required rows={5} maxLength={5000} value={body} onChange={e=>setBody(e.target.value)} /></label>
          <div className="bac-two-col">
            <label>ערוץ שליחה<select value={channel} onChange={e=>setChannel(e.target.value as typeof channel)}><option value="in_app">הודעה בתוך המערכת</option><option value="email">דוא״ל</option><option value="both">הודעה + דוא״ל</option></select></label>
            <label>סוג הודעה<select value={category} onChange={e=>setCategory(e.target.value as typeof category)}><option value="service">הודעת שירות/תפעול</option><option value="marketing">הודעה שיווקית</option></select></label>
          </div>
          {category==='marketing'&&channel!=='in_app'&&<p className="bac-note">דוא״ל שיווקי יישלח רק לבעלי עסקים שנתנו הסכמה לקבלת דיוור שיווקי בדוא״ל. נמענים ללא הסכמה יופיעו כהוחרגו בהיסטוריה.</p>}
          <fieldset className="bac-audience"><legend>קהל יעד</legend>
            <label className="bac-check"><input type="radio" name="audience" checked={audience==='all'} onChange={()=>setAudience('all')} /> כל בעלי העסקים ({businesses.length})</label>
            <label className="bac-check"><input type="radio" name="audience" checked={audience==='selected'} onChange={()=>setAudience('selected')} /> בחירת עסקים</label>
            {audience==='selected'&&<div className="bac-business-picker">{businesses.map(item=><label key={item.id} className="bac-check"><input type="checkbox" checked={selectedIds.includes(item.id)} onChange={e=>setSelectedIds(current=>e.target.checked?[...current,item.id]:current.filter(id=>id!==item.id))} /><span>{item.name} <small>/biz/{item.slug}</small></span></label>)}</div>}
          </fieldset>
          <button type="submit" disabled={saving||!title.trim()||!body.trim()||(audience==='selected'&&!selectedIds.length)} className="bac-primary">{saving?'שולח…':'בדיקה ואישור שליחה'}</button>
        </form>
      </section>

      <section className="bac-section">
        <div className="bac-section-heading"><div><span>04 / HISTORY</span><h2>היסטוריית הודעות ושליחות</h2><p>אישור ספק אינו מעיד על מסירה או פתיחה. פתיחה בתוך המערכת נספרת רק לאחר שבעל העסק סימן את ההודעה כנקראה.</p></div></div>
        {history.length===0?<p className="bac-empty">עדיין לא נשלחו הודעות.</p>:<div className="bac-history">{history.map(item=><article key={item.id}>
          <div className="bac-history-top"><div><b>{item.title}</b><p>{new Date(item.created_at).toLocaleString('he-IL')}</p></div><span>{item.status==='accepted'?'התקבל אצל הספק':item.status==='partial'?'נשלח חלקית':item.status==='failed'?'נכשל':'בתהליך'}</span></div>
          <p className="bac-history-body">{item.body}</p>
          <div className="bac-history-stats"><span>נמענים: {item.recipient_count}</span><span>דוא״ל התקבל אצל הספק: {item.email_accepted_count}</span><span>כשלונות: {item.email_failed_count}</span><span>הוחרגו: {item.email_skipped_count}</span><span>נקראו במערכת: {item.in_app_read_count}</span></div>
        </article>)}</div>}
      </section>
    </div>
  </main>;
}
