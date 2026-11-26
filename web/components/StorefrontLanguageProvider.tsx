"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import {
  getStoredStorefrontLanguage,
  getStorefrontDirection,
  getStorefrontLocale,
  normalizeStorefrontLanguage,
  storeStorefrontLanguage,
  translateStorefront,
  type StorefrontLanguage,
  type StorefrontMessageKey,
} from "@/lib/storefrontI18n";

type StorefrontLanguageContextValue = {
  language: StorefrontLanguage;
  setLanguage: (language: StorefrontLanguage) => void;
};

const StorefrontLanguageContext = createContext<StorefrontLanguageContextValue | null>(null);

export default function StorefrontLanguageProvider({
  slug,
  businessLocale,
  children,
}: {
  slug: string;
  businessLocale: string | null | undefined;
  children: ReactNode;
}) {
  const [language, setLanguageState] = useState<StorefrontLanguage>(() =>
    normalizeStorefrontLanguage(businessLocale),
  );

  useEffect(() => {
    const stored = getStoredStorefrontLanguage(slug);
    if (stored) setLanguageState(stored);
  }, [slug]);

  const setLanguage = (next: StorefrontLanguage) => {
    setLanguageState(next);
    storeStorefrontLanguage(slug, next);
  };

  return (
    <StorefrontLanguageContext.Provider value={{ language, setLanguage }}>
      <div lang={getStorefrontLocale(language)} dir={getStorefrontDirection(language)}>
        {children}
      </div>
    </StorefrontLanguageContext.Provider>
  );
}

function useStorefrontLanguage() {
  const context = useContext(StorefrontLanguageContext);
  if (!context) throw new Error("Storefront language components must be inside StorefrontLanguageProvider");
  return context;
}

export function useStorefrontLocale() {
  const { language } = useStorefrontLanguage();
  return getStorefrontLocale(language);
}

export function useStorefrontTranslation() {
  const { language } = useStorefrontLanguage();
  return useCallback((message: StorefrontMessageKey) => translateStorefront(language, message), [language]);
}

export function StorefrontText({ message }: { message: StorefrontMessageKey }) {
  const { language } = useStorefrontLanguage();
  return <>{translateStorefront(language, message)}</>;
}

export function StorefrontLanguageSwitcher() {
  const { language, setLanguage } = useStorefrontLanguage();

  return (
    <div className="mx-auto flex max-w-6xl justify-end px-4 pt-3">
      <label className="inline-flex min-h-10 items-center gap-2 rounded-full border border-ink/15 bg-white px-3 text-sm font-semibold text-ink shadow-sm">
        <span>{translateStorefront(language, "language")}</span>
        <select
          value={language}
          onChange={(event) => setLanguage(event.target.value as StorefrontLanguage)}
          className="min-h-8 bg-transparent text-sm font-semibold outline-none"
          aria-label={translateStorefront(language, "language")}
        >
          <option value="he">עברית</option>
          <option value="en">English</option>
          <option value="ru">Русский</option>
        </select>
      </label>
    </div>
  );
}

const DAY_MESSAGE_KEYS = {
  sun: "daySunday",
  mon: "dayMonday",
  tue: "dayTuesday",
  wed: "dayWednesday",
  thu: "dayThursday",
  fri: "dayFriday",
  sat: "daySaturday",
} as const satisfies Record<string, StorefrontMessageKey>;

export function StorefrontDayName({ day }: { day: keyof typeof DAY_MESSAGE_KEYS }) {
  return <StorefrontText message={DAY_MESSAGE_KEYS[day]} />;
}
