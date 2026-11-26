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
    ourProducts: "המוצרים שלנו",
    ourServices: "השירותים שלנו",
    selectProductToAdd: "בחרו מוצר כדי להוסיף אותו להזמנה.",
    selectServiceToAdd: "בחרו שירות כדי להוסיף אותו להזמנה.",
    searchProducts: "חיפוש מוצרים",
    searchServices: "חיפוש שירותים",
    searchByNameOrDescription: "חיפוש לפי שם או תיאור…",
    searchingItems: "מחפשים פריטים…",
    noSearchResults: "לא נמצאו פריטים התואמים לחיפוש.",
    products: "מוצרים",
    services: "שירותים",
    itemsShown: "מוצגים",
    of: "מתוך",
    items: "פריטים",
    loadingItems: "טוען פריטים…",
    showMoreItems: "הצגת עוד פריטים",
    selectedProducts: "מוצרים נבחרו",
    selectedServices: "שירותים נבחרו",
    continueToInquiry: "המשך לשליחת פנייה",
    chooseCoordinationMethod: "בחירת דרך תיאום",
    contactAboutProducts: "שליחת פנייה לגבי המוצרים",
    clearProductSelection: "ביטול בחירת המוצרים וניקוי ההזמנה",
    clearServiceSelection: "ביטול בחירת השירותים וניקוי ההזמנה",
    clearProducts: "ניקוי בחירת המוצרים",
    clearServices: "ניקוי בחירת השירותים",
    closeConfirmation: "סגירת הודעת האישור; התור נשאר שמור",
    closeOrderDialog: "סגירת חלון ההזמנה",
    hoursOfOperation: "שעות פעילות",
    allOpeningHours: "כל שעות הפעילות",
    closed: "סגור",
    daySunday: "ראשון",
    dayMonday: "שני",
    dayTuesday: "שלישי",
    dayWednesday: "רביעי",
    dayThursday: "חמישי",
    dayFriday: "שישי",
    daySaturday: "שבת",
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
    ourProducts: "Our products",
    ourServices: "Our services",
    selectProductToAdd: "Choose a product to add it to your order.",
    selectServiceToAdd: "Choose a service to add it to your order.",
    searchProducts: "Search products",
    searchServices: "Search services",
    searchByNameOrDescription: "Search by name or description…",
    searchingItems: "Searching…",
    noSearchResults: "No items match your search.",
    products: "Products",
    services: "Services",
    itemsShown: "Showing",
    of: "of",
    items: "items",
    loadingItems: "Loading items…",
    showMoreItems: "Show more items",
    selectedProducts: "products selected",
    selectedServices: "services selected",
    continueToInquiry: "Continue to inquiry",
    chooseCoordinationMethod: "Choose how to proceed",
    contactAboutProducts: "Send an inquiry about the products",
    clearProductSelection: "Clear product selection and empty the order",
    clearServiceSelection: "Clear service selection and empty the order",
    clearProducts: "Clear product selection",
    clearServices: "Clear service selection",
    closeConfirmation: "Close confirmation; the appointment remains saved",
    closeOrderDialog: "Close order window",
    hoursOfOperation: "Opening hours",
    allOpeningHours: "All opening hours",
    closed: "Closed",
    daySunday: "Sunday",
    dayMonday: "Monday",
    dayTuesday: "Tuesday",
    dayWednesday: "Wednesday",
    dayThursday: "Thursday",
    dayFriday: "Friday",
    daySaturday: "Saturday",
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
    ourProducts: "Наши товары",
    ourServices: "Наши услуги",
    selectProductToAdd: "Выберите товар, чтобы добавить его в заказ.",
    selectServiceToAdd: "Выберите услугу, чтобы добавить её в заказ.",
    searchProducts: "Поиск товаров",
    searchServices: "Поиск услуг",
    searchByNameOrDescription: "Поиск по названию или описанию…",
    searchingItems: "Ищем…",
    noSearchResults: "По вашему запросу ничего не найдено.",
    products: "Товары",
    services: "Услуги",
    itemsShown: "Показано",
    of: "из",
    items: "позиций",
    loadingItems: "Загрузка…",
    showMoreItems: "Показать ещё",
    selectedProducts: "товаров выбрано",
    selectedServices: "услуг выбрано",
    continueToInquiry: "Перейти к запросу",
    chooseCoordinationMethod: "Выбрать способ связи",
    contactAboutProducts: "Запрос о товарах",
    clearProductSelection: "Очистить выбор товаров и заказ",
    clearServiceSelection: "Очистить выбор услуг и заказ",
    clearProducts: "Очистить выбор товаров",
    clearServices: "Очистить выбор услуг",
    closeConfirmation: "Закрыть подтверждение; запись остаётся сохранённой",
    closeOrderDialog: "Закрыть окно заказа",
    hoursOfOperation: "Часы работы",
    allOpeningHours: "Все часы работы",
    closed: "Закрыто",
    daySunday: "Воскресенье",
    dayMonday: "Понедельник",
    dayTuesday: "Вторник",
    dayWednesday: "Среда",
    dayThursday: "Четверг",
    dayFriday: "Пятница",
    daySaturday: "Суббота",
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
    const rawLanguage = stored.trim().toLowerCase().split(/[-_]/, 1)[0];
    if (!STOREFRONT_LANGUAGES.includes(rawLanguage as StorefrontLanguage) && rawLanguage !== "iw") {
      return null;
    }
    return normalizeStorefrontLanguage(stored);
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
