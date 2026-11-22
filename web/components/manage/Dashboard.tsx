'use client';

import { useEffect, useState } from 'react';
import { themeVars } from '@/lib/theme';
import PwaInstallButton from '@/components/PwaInstallButton';
import type { CrmRetentionSummary, LeadsResponse, ManageBusiness } from '@/lib/types';
import BusinessPanel from './BusinessPanel';
import DesignPanel from './DesignPanel';
import CalendarPanel from './CalendarPanel';
import GalleryPanel from './GalleryPanel';
import HoursPanel from './HoursPanel';
import LeadsPanel from './LeadsPanel';
import LegalPanel from './LegalPanel';
import ProductsPanel from './ProductsPanel';
import WaitlistPanel from './WaitlistPanel';
import GoogleCalendarPanel from './GoogleCalendarPanel';

type Tab = 'leads' | 'calendar' | 'waitlist' | 'products' | 'gallery' | 'hours' | 'business' | 'design' | 'legal';
const TABS: [Tab, string][] = [
  ['leads', 'פניות'], ['calendar', 'יומן תורים'], ['waitlist', 'רשימת המתנה'], ['products', 'מוצרים'], ['gallery', 'גלריה'], ['hours', 'שעות'], ['business', 'פרטי העסק'], ['design', 'עיצוב האתר'], ['legal', 'מסמכי האתר'],
];

export default function Dashboard({ token, initialBusiness, initialLeads, initialRetention }: {
  token: string; initialBusiness: ManageBusiness; initialLeads: LeadsResponse; initialRetention: CrmRetentionSummary;
}) {
  const [tab, setTab] = useState<Tab>('leads');
  const [biz, setBiz] = useState(initialBusiness);
  const [claimState, setClaimState] = useState<'checking' | 'claimable' | 'connected'>('checking');
  const [claiming, setClaiming] = useState(false);
  const [claimMessage, setClaimMessage] = useState('');
  const [claimError, setClaimError] = useState('');
  const [onboardingCompleted, setOnboardingCompleted] = useState(Boolean(initialBusiness.onboarding_completed_at));
  const [onboardingVisible, setOnboardingVisible] = useState(!initialBusiness.onboarding_completed_at);
  const [onboardingSaving, setOnboardingSaving] = useState(false);
  const [onboardingError, setOnboardingError] = useState('');
  const [onboardingMessage, setOnboardingMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/me', { cache: 'no-store', credentials: 'same-origin' })
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (cancelled) return;
        if (response.ok && data?.user?.role === 'super_admin') {
          setClaimState('connected');
        } else if (response.ok && data?.user?.business_slug === biz.slug) {
          setClaimState('connected');
        } else {
          setClaimState('claimable');
        }
      })
      .catch(() => { if (!cancelled) setClaimState('claimable'); });
    return () => { cancelled = true; };
  }, [biz.slug]);

  async function completeOnboarding() {
    setOnboardingSaving(true);
    setOnboardingError('');
    setOnboardingMessage('');
    try {
      const response = await fetch(`/api/manage/${token}/onboarding/complete`, {
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.completed_at) {
        throw new Error('לא הצלחנו לשמור את השלמת ההקמה. אפשר לנסות שוב.');
      }
      setOnboardingCompleted(true);
      setOnboardingVisible(false);
      setOnboardingMessage('איזה יופי! העסק מוכן להמשך עבודה.');
    } catch (error) {
      setOnboardingError(error instanceof Error ? error.message : 'שמירת ההתקדמות נכשלה.');
    } finally {
      setOnboardingSaving(false);
    }
  }

  async function copyCustomerLink() {
    const customerUrl = `${window.location.origin}/biz/${biz.slug}`;
    try {
      await navigator.clipboard.writeText(customerUrl);
      setOnboardingMessage('קישור האתר ללקוחות הועתק. אפשר לשלוח אותו בוואטסאפ.');
    } catch {
      setOnboardingError('לא ניתן להעתיק אוטומטית. אפשר לפתוח את תצוגת הלקוחות ולהעתיק את הכתובת.');
    }
  }

  async function claimBusiness() {
    setClaiming(true);
    setClaimMessage('');
    setClaimError('');
    try {
      const response = await fetch('/api/auth/claim-business', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
        cache: 'no-store',
        credentials: 'same-origin',
      });
      const data = await response.json().catch(() => null);
      if (response.status === 401) {
        window.location.assign('/login?next=' + encodeURIComponent('/manage/' + token));
        return;
      }
      if (!response.ok) {
        const messages: Record<string, string> = {
          business_claim_email_mismatch: 'כתובת המייל בחשבון אינה תואמת לכתובת המייל שמוגדרת בעסק. יש להתחבר עם כתובת המייל של בעל העסק או לפנות לסופר־אדמין לעדכון.',
          business_claim_email_required: 'לא הוגדרה כתובת מייל לעסק. יש לפנות לסופר־אדמין כדי לאמת את בעלות העסק.',
          business_already_claimed: 'העסק כבר מחובר לחשבון אחר. אם זו טעות, יש לפנות לסופר־אדמין.',
          business_already_exists: 'החשבון שלך כבר מחובר לעסק אחר. חשבון אחד יכול לנהל עסק אחד.',
          subscription_inactive: 'לא ניתן לחבר עסק שהגישה אליו חסומה כרגע. יש לפנות לסופר־אדמין.',
        };
        throw new Error(messages[data?.error] ?? data?.message ?? 'לא ניתן לחבר את העסק לחשבון.');
      }
      setClaimState('connected');
      setClaimMessage(data?.already_claimed ? 'העסק כבר מחובר לחשבון שלך.' : 'העסק חובר לחשבון שלך. הקישור הקבוע נשאר ללא שינוי.');
      window.location.reload();
    } catch (error) {
      setClaimError(error instanceof Error ? error.message : 'חיבור העסק נכשל.');
    } finally {
      setClaiming(false);
    }
  }


  return (
    <div
      className="brand-root min-h-screen bg-surface text-ink"
      style={themeVars(biz.config?.branding?.colors)}
    >
      <div className="mx-auto max-w-6xl px-3 py-4 sm:px-6 sm:py-7">
        <header className="flex flex-wrap items-center justify-between gap-4 rounded-[1.5rem] border border-ink/10 bg-white px-4 py-5 shadow-sm sm:rounded-[1.75rem] sm:px-6 sm:py-6">
          <div>
            <p className="text-xs font-semibold text-ink/55">אזור אישי לעסק</p>
            <h1 className="mt-1 text-xl font-extrabold tracking-tight">{biz.name}</h1>
            <p className="mt-1 text-sm text-ink/65">ניהול האתר, הפניות והתוכן במקום אחד</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <PwaInstallButton label="התקנת ניהול העסק" />
            <a href="/account" className="rounded-full border border-ink/20 px-4 py-2 text-sm font-semibold text-ink hover:bg-ink/5">
              הגדרות חשבון
            </a>
            <a href={`/biz/${biz.slug}`} target="_blank" rel="noopener noreferrer"
              className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-fg hover:opacity-90">
              צפייה באתר ↗
            </a>
          </div>
        </header>

        {claimState === 'claimable' && <section className="mt-4 rounded-2xl border border-ink/15 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-bold">חיבור העסק לחשבון BTime</h2>
              <p className="mt-1 text-sm leading-6 text-ink/65">אפשר לחבר את העסק לחשבון שלך כדי להיכנס אליו גם דרך מסך ההתחברות הראשי, בלי להסתמך על הקישור בלבד. יש להתחבר עם כתובת המייל שמוגדרת בעסק.</p>
            </div>
            <button type="button" onClick={claimBusiness} disabled={claiming} className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-fg disabled:opacity-50">
              {claiming ? 'מחבר את העסק…' : 'חיבור העסק לחשבון שלי'}
            </button>
          </div>
          {claimMessage && <p role="status" className="mt-2 text-sm text-emerald-800">{claimMessage}</p>}
          {claimError && <p role="alert" className="mt-2 text-sm text-red-700">{claimError}</p>}
        </section>}

        {!onboardingCompleted && onboardingVisible && <section className="mt-4 rounded-2xl border border-primary/20 bg-primary/5 p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold tracking-wide text-primary">ברוכים הבאים ל-BTime</p>
              <h2 className="mt-1 text-xl font-bold text-ink">בואו נכין את העסק לקבלת לקוחות</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-ink/70">נעבור יחד על כמה דברים פשוטים. אפשר לבצע אותם עכשיו או לחזור אליהם בהמשך — בכל שלב תוכלו לראות איך העסק נראה ללקוחות.</p>
            </div>
            <button type="button" onClick={() => setOnboardingVisible(false)} className="rounded-full border border-ink/20 bg-white px-3 py-2 text-xs font-semibold text-ink">אחר כך</button>
          </div>
          <ol className="mt-4 grid gap-2 sm:grid-cols-2">
            <li><button type="button" onClick={() => setTab('business')} className="w-full rounded-xl border border-ink/10 bg-white p-3 text-right hover:border-primary/40">
              <span className="block text-sm font-bold">1. פרטי העסק ודרכי יצירת קשר</span><span className="mt-1 block text-xs text-ink/60">שם העסק, טלפון, תיאור ופרטים שיוצגו באתר.</span>
            </button></li>
            <li><button type="button" onClick={() => setTab('products')} className="w-full rounded-xl border border-ink/10 bg-white p-3 text-right hover:border-primary/40">
              <span className="block text-sm font-bold">2. הוספת שירותים או מוצרים</span><span className="mt-1 block text-xs text-ink/60">מה הלקוחות יכולים להזמין או לתאם.</span>
            </button></li>
            <li><button type="button" onClick={() => setTab('hours')} className="w-full rounded-xl border border-ink/10 bg-white p-3 text-right hover:border-primary/40">
              <span className="block text-sm font-bold">3. שעות פעילות וזמינות</span><span className="mt-1 block text-xs text-ink/60">הגדירו מתי העסק מקבל לקוחות.</span>
            </button></li>
            <li><button type="button" onClick={() => setTab('design')} className="w-full rounded-xl border border-ink/10 bg-white p-3 text-right hover:border-primary/40">
              <span className="block text-sm font-bold">4. התאמת מראה האתר</span><span className="mt-1 block text-xs text-ink/60">תמונות, צבעים וסגנון שמתאימים לעסק.</span>
            </button></li>
          </ol>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <a href={`/biz/${biz.slug}`} target="_blank" rel="noopener noreferrer" className="rounded-full border border-ink/20 bg-white px-4 py-2 text-sm font-semibold text-ink">כך הלקוחות יראו את העסק</a>
            <button type="button" onClick={copyCustomerLink} className="rounded-full border border-ink/20 bg-white px-4 py-2 text-sm font-semibold text-ink">העתקת קישור ללקוחות</button>
            <button type="button" onClick={completeOnboarding} disabled={onboardingSaving} className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-fg disabled:opacity-50">{onboardingSaving ? 'שומר…' : 'סיימתי, העסק מוכן לקבל לקוחות'}</button>
          </div>
          {onboardingError && <p role="alert" className="mt-3 text-sm text-red-700">{onboardingError}</p>}
          {onboardingMessage && <p role="status" className="mt-3 text-sm text-emerald-800">{onboardingMessage}</p>}
        </section>}

        {(initialRetention.due_within_7_days > 0 || initialRetention.overdue > 0) && (
          <section role="status" className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
            <p className="font-bold">תזכורת: מדיניות שמירת המידע של פניות CRM</p>
            {initialRetention.overdue > 0 && <p className="mt-1">{initialRetention.overdue} פניות עברו את תקופת השמירה וממתינות לניקוי המתוזמן.</p>}
            {initialRetention.overdue === 0 && initialRetention.due_within_24_hours > 0 && <p className="mt-1">{initialRetention.due_within_24_hours} פניות צפויות להימחק בתוך 24 שעות.</p>}
            {initialRetention.overdue === 0 && initialRetention.due_within_24_hours === 0 && initialRetention.due_within_7_days > 0 && <p className="mt-1">{initialRetention.due_within_7_days} פניות צפויות להימחק בתוך 7 ימים.</p>}
            <p className="mt-1">מומלץ לייצא את הפניות והערות המוכר לפני המחיקה.</p>
            <button type="button" onClick={() => setTab('leads')} className="mt-2 rounded-full border border-amber-700 px-3 py-1.5 font-semibold">מעבר לפניות ולייצוא</button>
          </section>
        )}

        <nav className="sticky top-2 z-30 mt-4 flex gap-2 overflow-x-auto rounded-2xl border border-ink/10 bg-surface/95 p-2 pb-2 shadow-sm backdrop-blur [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="ניווט">
          {TABS.map(([id, label]) => (
            <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)}
              className={`min-h-11 shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold transition-colors ${tab === id ? 'bg-primary text-primary-fg shadow-sm' : 'bg-white text-ink ring-1 ring-ink/15 hover:bg-primary/5'}`}>
              {label}
            </button>
          ))}
        </nav>

        <div className="mt-5">
          {tab === 'leads' && <LeadsPanel token={token} initial={initialLeads} />}
          {tab === 'calendar' && <><GoogleCalendarPanel token={token} /><CalendarPanel token={token} biz={biz} /></>}
          {tab === 'waitlist' && <WaitlistPanel token={token} />}
          {tab === 'products' && <ProductsPanel token={token} />}
          {tab === 'gallery' && <GalleryPanel token={token} />}
          {tab === 'hours' && <HoursPanel token={token} biz={biz} onSaved={setBiz} />}
          <div hidden={tab !== 'business'}><BusinessPanel token={token} biz={biz} onSaved={setBiz} /></div>
          <div hidden={tab !== 'design'}><DesignPanel token={token} biz={biz} onSaved={setBiz} /></div>
          {tab === 'legal' && <LegalPanel token={token} biz={biz} onSaved={setBiz} />}
        </div>
      </div>
    </div>
  );
}
