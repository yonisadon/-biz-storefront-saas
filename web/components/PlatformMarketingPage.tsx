'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

const capabilities = [
  {
    number: '01',
    title: 'אתר עסקי משלך',
    description: 'עמוד ברור ומקצועי שאפשר לשלוח ללקוחות, עם הפרטים, התמונות וההצעה העסקית שלך.',
    symbol: '↗',
  },
  {
    number: '02',
    title: 'ניהול במקום אחד',
    description: 'עדכון מוצרים, שירותים, מחירים ופרטי העסק בלי להסתבך עם בניית אתר.',
    symbol: '▦',
  },
  {
    number: '03',
    title: 'פניות ותורים',
    description: 'קבלת פניות וניהול תורים בהתאם לאופן שבו העסק שלך עובד.',
    symbol: '◷',
  },
];

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

const DEFAULT_MARKETING_CONTENT: MarketingContent = {
  heroEyebrow: 'העסק שלך. פשוט יותר.',
  heroTitle: 'כל מה שהעסק שלך צריך כדי להיות נוכח ולהתנהל.',
  heroDescription: 'אתר עסקי שאפשר לשתף עם לקוחות, יחד עם כלים נוחים להצגת מוצרים ושירותים, לקבלת פניות ולניהול תורים — בלי להסתבך עם בניית אתר.',
  announcementEnabled: false,
  announcementTitle: '',
  announcementBody: '',
  heroImageUrl: null,
  screenshotUrls: [],
};

export default function PlatformMarketingPage() {
  const [content, setContent] = useState<MarketingContent>(DEFAULT_MARKETING_CONTENT);

  useEffect(() => {
    let active = true;
    fetch('/api/platform-content/marketing', { cache: 'no-store' })
      .then(async (response) => response.ok ? response.json() : null)
      .then((data) => {
        if (!active || !data?.content) return;
        setContent({ ...DEFAULT_MARKETING_CONTENT, ...data.content });
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  return (
    <main className="btime-marketing" dir="rtl">
      <header className="bm-header">
        <div className="bm-header-inner">
          <Link href="/" className="bm-brand" aria-label="BTime — עמוד הבית">
            <span className="bm-brand-mark" aria-hidden="true">B</span>
            <span>BTime</span>
          </Link>
          <nav className="bm-nav" aria-label="ניווט ראשי">
            <a href="#how-it-works">איך זה עובד</a>
            <a href="#for-businesses">למי זה מתאים</a>
            <a href="#features">מה מקבלים</a>
          </nav>
          <div className="bm-header-actions">
            <Link href="/login" className="bm-login">התחברות</Link>
            <Link href="/register" className="bm-button bm-button-small">פתיחת חשבון</Link>
          </div>
        </div>
      </header>
      {content.announcementEnabled && content.announcementBody && <aside className="bm-announcement" role="status">
        <strong>{content.announcementTitle || 'עדכון מ-BTime'}</strong>
        <span>{content.announcementBody}</span>
      </aside>}

      <section className="bm-hero">
        <div className="bm-hero-inner">
          <div className="bm-hero-copy">
            <p className="bm-eyebrow"><span /> {content.heroEyebrow}</p>
            <h1>{content.heroTitle}</h1>
            <p className="bm-hero-lead">{content.heroDescription}</p>
            <div className="bm-hero-actions">
              <Link href="/register" className="bm-button">מתחילים עם BTime <span aria-hidden="true">←</span></Link>
              <Link href="#how-it-works" className="bm-text-link">מגלים איך זה עובד <span aria-hidden="true">↓</span></Link>
            </div>
            <p className="bm-reassurance">פתיחת חשבון פשוטה · 30 ימי ניסיון לעסק חדש · בלי התחייבות</p>
          </div>

          <div className="bm-visual" aria-label="המחשה של אתר עסקי וממשק ניהול ב-BTime">
            <div className="bm-visual-orbit bm-orbit-one" aria-hidden="true" />
            <div className="bm-visual-orbit bm-orbit-two" aria-hidden="true" />
            {content.heroImageUrl && <div className="bm-hero-uploaded-image"><img src={content.heroImageUrl} alt="תמונה מתוך מערכת BTime" /></div>}
            <div className="bm-browser bm-store-preview">
              <div className="bm-browser-bar"><span /><span /><span /><b>האתר של העסק</b></div>
              <div className="bm-store-content">
                <div className="bm-store-topline"><span className="bm-store-logo" /><span className="bm-store-menu">דף הבית　 שירותים　 יצירת קשר</span></div>
                <div className="bm-store-hero">
                  <div className="bm-store-kicker">העסק שלך, בדרך שלך</div>
                  <div className="bm-store-title"><i /><i /><i /></div>
                  <div className="bm-store-lines"><i /><i /></div>
                  <span className="bm-store-cta" />
                </div>
                <div className="bm-store-items">
                  <div><span /><i /><i /></div>
                  <div><span /><i /><i /></div>
                  <div><span /><i /><i /></div>
                </div>
              </div>
            </div>
            <div className="bm-browser bm-admin-preview">
              <div className="bm-admin-head"><span className="bm-admin-dot" /><b>ניהול העסק</b><small>הכול מסודר במקום אחד</small></div>
              <div className="bm-admin-body">
                <div className="bm-admin-sidebar"><i /><i /><i /><i /></div>
                <div className="bm-admin-main">
                  <div className="bm-admin-welcome"><i /><i /></div>
                  <div className="bm-admin-stats"><i /><i /><i /></div>
                  <div className="bm-admin-calendar"><i /><i /><i /><i /><i /><i /></div>
                </div>
              </div>
            </div>
            <div className="bm-floating-note"><span aria-hidden="true">✓</span><div><b>פשוט לעדכן</b><small>גם מהנייד</small></div></div>
          </div>
        </div>
        <div className="bm-hero-bottom"><span>נוכחות דיגיטלית</span><i /><span>ניהול פשוט</span><i /><span>יותר זמן לעסק</span></div>
      </section>

      <section className="bm-audience" id="for-businesses">
        <div className="bm-section-heading">
          <p className="bm-eyebrow">מתאים לאופן שבו העסק שלך עובד</p>
          <h2>מוצרים, שירותים — או גם וגם.</h2>
          <p>לא צריך להתאים את העסק לתבנית אחת. מציגים את מה שמציעים ומנהלים את הפעילות בדרך שמתאימה לך.</p>
        </div>
        <div className="bm-audience-grid">
          <article className="bm-audience-item bm-audience-service"><span className="bm-audience-index">01 / שירותים</span><div className="bm-audience-art bm-art-calendar"><i /><i /><i /><i /><i /><i /></div><h3>עסקים מבוססי שירות</h3><p>להציג שירותים, להסביר מה מקבלים ולאפשר ללקוחות לפנות או לקבוע תור, בהתאם להגדרות העסק.</p></article>
          <article className="bm-audience-item bm-audience-products"><span className="bm-audience-index">02 / מוצרים</span><div className="bm-audience-art bm-art-products"><i /><i /><i /></div><h3>חנויות ועסקים עם מוצרים</h3><p>להציג קטלוג, תמונות ומחירים, ולעזור ללקוחות להבין מה אפשר להזמין ואיך יוצרים קשר.</p></article>
          <article className="bm-audience-item bm-audience-mixed"><span className="bm-audience-index">03 / משולב</span><div className="bm-audience-art bm-art-mixed"><i /><i /><i /><i /></div><h3>עסקים שמשלבים הכול</h3><p>מוצרים ושירותים יכולים לחיות יחד באותו אתר — בלי לוותר על אף אחד מהם.</p></article>
        </div>
      </section>

      <section className="bm-how" id="how-it-works">
        <div className="bm-how-intro">
          <p className="bm-eyebrow">מתחילים בכמה צעדים</p>
          <h2>פחות התעסקות באתר.<br /><em>יותר פוקוס על העסק.</em></h2>
          <p>פותחים חשבון, מקימים את העסק וממשיכים לנהל ולעדכן את התוכן בעצמך.</p>
          <Link href="/register" className="bm-button bm-button-dark">פתיחת חשבון <span aria-hidden="true">←</span></Link>
        </div>
        <ol className="bm-steps">
          <li><span>01</span><div><h3>פותחים חשבון</h3><p>נרשמים ומאמתים את כתובת הדוא״ל.</p></div></li>
          <li><span>02</span><div><h3>מקימים את העסק</h3><p>מגדירים את שם העסק וכתובת האתר שלו.</p></div></li>
          <li><span>03</span><div><h3>מתחילים לנהל</h3><p>מוסיפים תוכן, מוצרים או שירותים ומשתפים את הקישור עם לקוחות.</p></div></li>
        </ol>
      </section>

      <section className="bm-capabilities" id="features">
        <div className="bm-section-heading bm-section-heading-row">
          <div><p className="bm-eyebrow">כלים שימושיים. בלי עומס.</p><h2>הבסיס לניהול עסק מסודר.</h2></div>
          <p>הכלים מוצגים בצורה פשוטה ונגישה, כדי שתוכל להתמקד במה שחשוב באמת.</p>
        </div>
        <div className="bm-capability-list">
          {capabilities.map((item) => (
            <article key={item.number} className="bm-capability">
              <span className="bm-capability-number">{item.number}</span>
              <h3>{item.title}</h3>
              <p>{item.description}</p>
              <span className="bm-capability-symbol" aria-hidden="true">{item.symbol}</span>
            </article>
          ))}
        </div>
      </section>

      {content.screenshotUrls.length > 0 && <section className="bm-screenshots" aria-label="הצצה למערכת BTime">
        <div className="bm-section-heading"><p className="bm-eyebrow">מבט מקרוב</p><h2>כך נראית העבודה עם BTime.</h2></div>
        <div className="bm-screenshots-grid">{content.screenshotUrls.map((url, index) => <figure key={url}><img src={url} alt={'צילום מסך ' + (index + 1) + ' של מערכת BTime'} /></figure>)}</div>
      </section>}

      <section className="bm-final-cta">
        <div><p className="bm-eyebrow">השלב הבא מתחיל כאן</p><h2>העסק שלך ראוי לנוכחות<br />דיגיטלית מסודרת.</h2></div>
        <div><p>פותחים חשבון ומתחילים להקים את האתר העסקי שלך.</p><Link href="/register" className="bm-button bm-button-light">מתחילים עם BTime <span aria-hidden="true">←</span></Link></div>
      </section>

      <footer className="bm-footer">
        <Link href="/" className="bm-brand"><span className="bm-brand-mark" aria-hidden="true">B</span><span>BTime</span></Link>
        <p>כלים פשוטים לנוכחות ולניהול העסק.</p>
        <div><Link href="/login">התחברות</Link><Link href="/register">פתיחת חשבון</Link><Link href="/platform-legal?returnTo=%2F">תנאי שימוש ופרטיות</Link></div>
      </footer>
    </main>
  );
}
