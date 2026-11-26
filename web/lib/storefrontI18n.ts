/**
 * Customer storefront UI language helpers.
 *
 * This module is intentionally isolated from business data and booking logic.
 * It contains no network calls, external translation services, or persistence
 * outside the visitor's browser.
 */

export const STOREFRONT_LANGUAGES = ["he", "en", "ru"] as const;

export type StorefrontLanguage = (typeof STOREFRONT_LANGUAGES)[number];
export type StorefrontDirection = "rtl" | "ltr";

const LANGUAGE_LOCALES: Record<StorefrontLanguage, string> = {
  he: "he-IL",
  en: "en",
  ru: "ru-RU",
};

const STORAGE_PREFIX = "btime:storefront-language:";

const messages = {
  he: {
    contact: "יצירת קשר",
    businessDetails: "פרטי העסק",
    openNow: "פתוח עכשיו",
    closedNow: "סגור עכשיו",
    businessAddress: "כתובת העסק",
    directions: "ניווט למקום",
    contactMethods: "דרכי התקשרות",
    legalAndAccessibility: "מידע משפטי ונגישות",
    skipToMainContent: "דילוג לתוכן המרכזי",
    language: "שפה",
  },
  en: {
    contact: "Contact",
    businessDetails: "Business details",
    openNow: "Open now",
    closedNow: "Closed now",
    businessAddress: "Business address",
    directions: "Get directions",
    contactMethods: "Contact options",
    legalAndAccessibility: "Legal information and accessibility",
    skipToMainContent: "Skip to main content",
    language: "Language",
  },
  ru: {
    contact: "Связаться",
    businessDetails: "Информация о компании",
    openNow: "Сейчас открыто",
    closedNow: "Сейчас закрыто",
    businessAddress: "Адрес компании",
    directions: "Как добраться",
    contactMethods: "Способы связи",
    legalAndAccessibility: "Юридическая информация и доступность",
    skipToMainContent: "Перейти к основному содержимому",
    language: "Язык",
  },
} as const;

export type StorefrontMessageKey = keyof (typeof messages)["he"];

/** Convert a stored business locale or browser choice to a supported language. */
export function normalizeStorefrontLanguage(value: string | null | undefined): StorefrontLanguage {
  const language = (value ?? "").trim().toLowerCase().split(/[-_]/, 1)[0];

  if (language === "en") return "en";
  if (language === "ru") return "ru";
  if (language === "he" || language === "iw") return "he";

  return "he";
}

/** A visitor choice takes precedence; otherwise use the business default. */
export function resolveStorefrontLanguage(
  businessLocale: string | null | undefined,
  visitorChoice?: string | null,
): StorefrontLanguage {
  if (visitorChoice) return normalizeStorefrontLanguage(visitorChoice);
  return normalizeStorefrontLanguage(businessLocale);
}

export function getStorefrontLocale(language: StorefrontLanguage): string {
  return LANGUAGE_LOCALES[language];
}

export function getStorefrontDirection(language: StorefrontLanguage): StorefrontDirection {
  return language === "he" ? "rtl" : "ltr";
}

export function translateStorefront(
  language: StorefrontLanguage,
  key: StorefrontMessageKey,
): string {
  return messages[language][key];
}

/** Read the visitor's choice for this business. Safe to call during SSR. */
export function getStoredStorefrontLanguage(slug: string): StorefrontLanguage | null {
  if (typeof window === "undefined") return null;

  try {
    const stored = window.localStorage.getItem(STORAGE_PREFIX + slug);
    if (!stored) return null;
    const normalized = normalizeStorefrontLanguage(stored);
    return STOREFRONT_LANGUAGES.includes(normalized) ? normalized : null;
  } catch {
    // Storage may be unavailable in private browsing or restricted contexts.
    return null;
  }
}

/** Store the visitor's choice for this business only. */
export function storeStorefrontLanguage(slug: string, language: StorefrontLanguage): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(STORAGE_PREFIX + slug, language);
  } catch {
    // Language switching still works for the current render if storage is unavailable.
  }
}
