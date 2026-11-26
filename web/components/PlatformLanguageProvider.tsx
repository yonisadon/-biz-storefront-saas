'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { platformDirection, translatePlatform, type PlatformLanguage, type PlatformMessageKey } from '@/lib/platformI18n';

type ContextValue = { language: PlatformLanguage; setLanguage: (language: PlatformLanguage) => void; t: (key: PlatformMessageKey) => string };
const Context = createContext<ContextValue | null>(null);
const STORAGE_KEY = 'btime-platform-language';

export default function PlatformLanguageProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isCustomerStorefront = pathname.startsWith('/biz/');
  const [language, setLanguageState] = useState<PlatformLanguage>('he');
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === 'he' || stored === 'en' || stored === 'ru') setLanguageState(stored);
    } catch { /* Storage may be unavailable; Hebrew remains the safe default. */ }
  }, []);
  useEffect(() => {
    const direction = platformDirection(language);
    if (!isCustomerStorefront) {
      document.documentElement.lang = language;
      document.documentElement.dir = direction;
    }
    try { window.localStorage.setItem(STORAGE_KEY, language); } catch { /* Language still works for this session. */ }
  }, [language, isCustomerStorefront]);
  const setLanguage = useCallback((next: PlatformLanguage) => setLanguageState(next), []);
  const t = useCallback((key: PlatformMessageKey) => translatePlatform(language, key), [language]);
  return <Context.Provider value={{ language, setLanguage, t }}>{children}</Context.Provider>;
}

export function usePlatformLanguage() {
  const value = useContext(Context);
  if (!value) throw new Error('Platform language components must be inside PlatformLanguageProvider');
  return value;
}

export function PlatformLanguageSwitcher({ className = '' }: { className?: string }) {
  const { language, setLanguage, t } = usePlatformLanguage();
  return <label className={'inline-flex min-h-9 items-center gap-2 rounded-full border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 ' + className}>
    <span>{t('language')}</span>
    <select value={language} onChange={event => setLanguage(event.target.value as PlatformLanguage)} className="min-h-8 bg-transparent outline-none" aria-label={t('language')}>
      <option value="he">עברית</option><option value="en">English</option><option value="ru">Русский</option>
    </select>
  </label>;
}
