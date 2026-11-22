'use client';

import { useEffect, useState } from 'react';

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

export default function PwaInstallButton({ label }: { label: string }) {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [help, setHelp] = useState('');

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches
      || (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    setInstalled(standalone);

    // Register a real service worker for PWA capability. It does not cache
    // private management pages or API responses.
    if ('serviceWorker' in window.navigator && window.isSecureContext) {
      window.navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
        setHelp('לא הצלחנו להפעיל את רכיב ההתקנה. כדאי לרענן את הדף ולנסות שוב.');
      });
    }

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
      setHelp('');
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  async function install() {
    if (installPrompt) {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === 'accepted') setHelp('אפליקציית הניהול נוספה למכשיר.');
      else setHelp('ההתקנה לא הושלמה. אפשר לנסות שוב מאותו מסך ניהול.');
      setInstallPrompt(null);
      return;
    }

    const isIos = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
    setHelp(isIos
      ? 'ב-iPhone/iPad ההתקנה נעשית דרך Safari: פתחו שיתוף ובחרו „הוספה למסך הבית”. כך האתר נפתח כאפליקציה נפרדת.'
      : 'הדפדפן עדיין לא הציע התקנה כאפליקציה. פתחו את קישור הניהול ב-Chrome ועדכנו את הדף. אם מופיעה רק אפשרות „יצירת קיצור דרך” — אל תבחרו בה; נבדוק מדוע הדפדפן לא מזהה את אפשרות ההתקנה.');
  }

  if (installed) return null;

  return (
    <div className="flex flex-col items-center gap-1">
      <button type="button" onClick={install}
        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-current/20 bg-white/90 px-4 py-2 text-sm font-semibold text-ink shadow-sm transition hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
        <span aria-hidden="true">＋</span>{label}
      </button>
      {help && <p role="status" className="max-w-sm text-center text-xs leading-5 text-ink/70">{help}</p>}
    </div>
  );
}
