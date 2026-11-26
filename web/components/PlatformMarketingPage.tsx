'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PlatformLanguageSwitcher, usePlatformLanguage } from '@/components/PlatformLanguageProvider';

type MarketingContent = {
  heroEyebrow: string;
  heroTitle: string;
  heroDescription: string;
  announcementEnabled: boolean;
  announcementTitle: string;
  announcementBody: string;
  announcements: Array<{ title: string; body: string }>;
  heroImageUrl: string | null;
  screenshotUrls: string[];
  demoBusinessEnabled: boolean;
  demoBusinessSlug: string | null;
  demoBusinessTitle: string;
  demoBusinessDescription: string;
};
type ContactDetails = { email: string | null; phone: string | null };

const DEFAULT_CONTENT: MarketingContent = {
  heroEyebrow: 'העסק שלך. פשוט יותר.',
  heroTitle: 'כל מה שהעסק שלך צריך, במקום אחד.',
  heroDescription: 'אתר עסקי להצגת השירותים והמוצרים שלך, יחד עם כלים פשוטים לניהול פניות ותורים.',
  announcementEnabled: false, announcementTitle: '', announcementBody: '', announcements: [],
  heroImageUrl: null, screenshotUrls: [], demoBusinessEnabled: false, demoBusinessSlug: null,
  demoBusinessTitle: '', demoBusinessDescription: '',
};

export default function PlatformMarketingPage() {
  const { t, language } = usePlatformLanguage();
  const [content, setContent] = useState<MarketingContent>(DEFAULT_CONTENT);
  const [contact, setContact] = useState<ContactDetails>({ email: null, phone: null });
  const [activeAnnouncementIndex, setActiveAnnouncementIndex] = useState(0);
  const [announcementPaused, setAnnouncementPaused] = useState(false);
  const announcements = content.announcementEnabled
    ? (content.announcements?.length ? content.announcements : content.announcementBody
      ? [{ title: content.announcementTitle, body: content.announcementBody }] : [])
    : [];

  useEffect(() => {
    setActiveAnnouncementIndex(current => Math.min(current, Math.max(0, announcements.length - 1)));
  }, [announcements.length]);

  useEffect(() => {
    if (announcements.length < 2 || announcementPaused || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(() => setActiveAnnouncementIndex(current => (current + 1) % announcements.length), 7000);
    return () => window.clearInterval(timer);
  }, [announcements.length, announcementPaused]);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch('/api/platform-content/marketing', { cache: 'no-store' }).then(response => response.ok ? response.json() : null),
      fetch('/api/platform-content/contact', { cache: 'no-store' }).then(response => response.ok ? response.json() : null),
    ]).then(([marketingData, contactData]) => {
      if (!active) return;
      if (marketingData?.content) setContent({ ...DEFAULT_CONTENT, ...marketingData.content });
      if (contactData) setContact({ email: contactData.email ?? null, phone: contactData.phone ?? null });
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  const whatsappHref = contact.phone ? 'https://wa.me/' + contact.phone.replace(/\D/g, '') : null;

  return (
    <main className="btime-marketing" dir={language === 'he' ? 'rtl' : 'ltr'}>
      <header className="bm-header">
        <div className="bm-header-inner">
          <Link href="/" className="bm-brand" aria-label="BTime — עמוד הבית">
            <span className="bm-brand-mark" aria-hidden="true">B</span><span>BTime</span>
          </Link>
          <nav className="bm-nav" aria-label={t('navBenefits')}>
            <a href="#gallery">{t('navGallery')}</a><a href="#quick-points">{t('navBenefits')}</a><a href="#contact">{t('navContact')}</a>
          </nav>
          <Link href="/login" className="bm-login">{t('login')}</Link>
          <PlatformLanguageSwitcher className="bm-language-switcher" />
        </div>
      </header>

      {announcements.length > 0 && <aside className="bm-announcement" role="region" aria-label="עדכונים מ-BTime"
        onMouseEnter={() => setAnnouncementPaused(true)} onMouseLeave={() => setAnnouncementPaused(false)}
        onFocus={() => setAnnouncementPaused(true)} onBlur={() => setAnnouncementPaused(false)}>
        <strong>{announcements[activeAnnouncementIndex]?.title || t('announcement')}</strong>
        <span>{announcements[activeAnnouncementIndex]?.body}</span>
        {announcements.length > 1 && <div className="bm-announcement-controls">
          <button type="button" aria-label={t('previous')} onClick={() => setActiveAnnouncementIndex(current => (current - 1 + announcements.length) % announcements.length)}>‹</button>
          <span aria-hidden="true">{activeAnnouncementIndex + 1}/{announcements.length}</span>
          <button type="button" aria-label={t('next')} onClick={() => setActiveAnnouncementIndex(current => (current + 1) % announcements.length)}>›</button>
        </div>}
      </aside>}

      <section className="bm-hero">
        <div className="bm-hero-inner">
          <div className="bm-hero-copy">
            <p className="bm-eyebrow">{content.heroEyebrow}</p>
            <h1>{content.heroTitle}</h1>
            <p className="bm-hero-lead">{content.heroDescription}</p>
            <Link href="/register" className="bm-button">{t('openAccount')} <span aria-hidden="true">{language === 'he' ? '←' : '→'}</span></Link>
            <p className="bm-reassurance">{t('trial')}</p>
          </div>
          <div className="bm-hero-visual">
            {content.heroImageUrl
              ? <Image src={content.heroImageUrl} alt={t('heroAlt')} width={900} height={650} priority sizes="(max-width: 700px) 100vw, 48vw" unoptimized />
              : <div className="bm-hero-placeholder" aria-hidden="true"><span>BTime</span><b>{t('demoSite')}</b><i /><i /><i /></div>}
          </div>
        </div>
      </section>

      <section className="bm-quick-points" id="quick-points" aria-label={t('benefits')}>
        <span>{t('ownSite')}</span><i /><span>{t('productsServices')}</span><i /><span>{t('inquiriesAppointments')}</span><i /><span>{t('mobileManagement')}</span>
      </section>

      {content.screenshotUrls.length > 0 && <section className="bm-gallery" id="gallery" aria-label="גלריית תמונות של BTime">
        <div className="bm-gallery-heading"><p className="bm-eyebrow">{t('galleryEyebrow')}</p><h2>{t('galleryTitle')}</h2></div>
        <div className="bm-gallery-grid">
          {content.screenshotUrls.map((url, index) => <figure key={url}>
            <Image src={url} alt={'דוגמה ' + (index + 1) + ' מתוך מערכת BTime'} width={1200} height={850} sizes="(max-width: 700px) 92vw, 45vw" unoptimized />
          </figure>)}
        </div>
      </section>}

      {content.demoBusinessEnabled && content.demoBusinessSlug && <section className="bm-demo">
        <div><p className="bm-eyebrow">{t('demoEyebrow')}</p><h2>{content.demoBusinessTitle || t('demoFallback')}</h2>
          {content.demoBusinessDescription && <p>{content.demoBusinessDescription}</p>}</div>
        <Link href={'/biz/' + content.demoBusinessSlug} target="_blank" rel="noreferrer" className="bm-text-link">{t('viewSite')} <span aria-hidden="true">↗</span></Link>
      </section>}

      <footer className="bm-footer" id="contact">
        <div className="bm-footer-brand"><Link href="/" className="bm-brand"><span className="bm-brand-mark" aria-hidden="true">B</span><span>BTime</span></Link>
          <p>{t('footerText')}</p></div>
        <div className="bm-contact-links">
          {whatsappHref && <a href={whatsappHref} target="_blank" rel="noreferrer" className="bm-contact-link">WhatsApp</a>}
          {contact.email && <a href={'mailto:' + contact.email} className="bm-contact-link">{t('sendEmail')}</a>}
          <Link href="/platform-legal?returnTo=%2F" className="bm-contact-legal">{t('legal')}</Link>
        </div>
      </footer>
    </main>
  );
}
