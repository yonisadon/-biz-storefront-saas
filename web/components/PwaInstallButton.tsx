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
      if (choice.outcome === 'accepted') setHelp('האפליקציה נוספה למכשיר.');
      setInstallPrompt(null);
      return;
    }

    const isIos = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
    setHelp(isIos
      ? 'ב-iPhone/iPad: פתחו את תפריט השיתוף ב-Safari ובחרו „הוספה למסך הבית”.'
      : 'פתחו את תפריט הדפדפן ובחרו „התקנת האפליקציה” או „הוספה למסך הבית”. אם האפשרות לא מופיעה, ודאו שהאתר פתוח בכתובת HTTPS ובדפדפן תומך.');
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
