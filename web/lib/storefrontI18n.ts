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
    appointmentBooking: "קביעת תור ביומן",
    businessNoHours: "העסק עדיין לא הגדיר שעות פעילות. אפשר להשאיר בקשת המתנה או לפנות ב-WhatsApp.",
    waitlistRequest: "בקשת הצטרפות לרשימת המתנה",
    whatsappContact: "פנייה ב-WhatsApp",
    continueWhatsApp: "המשך ל־WhatsApp",
    inquiryOnSite: "השארת פנייה באתר",
    chooseOneMethod: "בחרו דרך אחת להמשך עבור כל השירותים שנבחרו.",
    productsInquiryNote: "הפריטים שבחרתם יצורפו לפנייה. מעבר ל־WhatsApp אינו שולח את ההודעה במקומכם.",
    appointmentPhone: "מספר טלפון לקביעת התור",
    back: "חזרה",
    savingAppointment: "שומר תור…",
    confirmAppointment: "אישור וקביעת התור",
    customerNameOptional: "שם (רשות)",
    phoneRequired: "מספר טלפון *",
    emailOptional: "אימייל (רשות)",
    saving: "שומר…",
    sendInquiry: "שליחת הפנייה",
    preferredDate: "תאריך מועדף *",
    preferredTimeOptional: "שעה מועדפת (רשות)",
    noteOptional: "הערה (רשות)",
    fullName: "שם מלא",
    sendWaitlist: "שליחת בקשת המתנה",
    sending: "שולחים…",
    backToCalendar: "חזרה ליומן",
    monthNow: "החודש",
    chooseDay: "בחירת יום בחודש",
    availableTimes: "שעות פנויות",
    morning: "בוקר",
    afternoon: "צהריים",
    evening: "ערב",
    availableSlots: "יש שעות פנויות",
    unavailableDays: "ימים אפורים אינם זמינים",
    checkingMonth: "בודקים זמינות לחודש…",
    monthLoadError: "לא הצלחנו לטעון את זמינות החודש. נסו לרענן את הדף.",
    chooseAvailableDay: "בחרו יום שבו מופיע סימון של זמינות.",
    checkingDaySlots: "בודקים שעות פנויות ליום שנבחר…",
    slotsLoadError: "לא הצלחנו לבדוק את השעות. נסו לבחור את היום מחדש.",
    noSlotsToday: "אין כרגע שעות פנויות ביום זה.",
    appointmentSummary: "סיכום התור",
    duration: "משך",
    noSuitableTime: "לא מצאתם מועד שמתאים לכם?",
    waitlistExplain: "אפשר להשאיר בקשת המתנה עם תאריך ושעה מועדפים. העסק יוכל לבדוק את האפשרות וליצור איתכם קשר; הבקשה אינה שומרת תור ביומן.",
    noBookingHours: "לא הוגדרו שעות פעילות שמאפשרות לקבוע תור. אפשר לבחור בקשת המתנה או לפנות לעסק ב-WhatsApp.",
    waitlistSuccess: "הבקשה נוספה לרשימת ההמתנה. העסק יוכל ליצור איתכם קשר; לא נשמר תור ביומן.",
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
    appointmentBooking: "Book an appointment",
    businessNoHours: "The business has not set opening hours yet. You can join the waitlist or contact the business on WhatsApp.",
    waitlistRequest: "Join the waitlist",
    whatsappContact: "Contact via WhatsApp",
    continueWhatsApp: "Continue to WhatsApp",
    inquiryOnSite: "Send an inquiry on the website",
    chooseOneMethod: "Choose one way to continue for all selected services.",
    productsInquiryNote: "Your selected items will be included in the inquiry. Moving to WhatsApp does not send the message for you.",
    appointmentPhone: "Phone number for the appointment",
    back: "Back",
    savingAppointment: "Saving appointment…",
    confirmAppointment: "Confirm appointment",
    customerNameOptional: "Name (optional)",
    phoneRequired: "Phone number *",
    emailOptional: "Email (optional)",
    saving: "Saving…",
    sendInquiry: "Send inquiry",
    preferredDate: "Preferred date *",
    preferredTimeOptional: "Preferred time (optional)",
    noteOptional: "Note (optional)",
    fullName: "Full name",
    sendWaitlist: "Send waitlist request",
    sending: "Sending…",
    backToCalendar: "Back to calendar",
    monthNow: "This month",
    chooseDay: "Choose a day of the month",
    availableTimes: "Available times",
    morning: "Morning",
    afternoon: "Afternoon",
    evening: "Evening",
    availableSlots: "Available times",
    unavailableDays: "Grey days are unavailable",
    checkingMonth: "Checking availability for this month…",
    monthLoadError: "Could not load this month's availability. Please refresh the page.",
    chooseAvailableDay: "Choose a day marked as available.",
    checkingDaySlots: "Checking available times for the selected day…",
    slotsLoadError: "Could not check the times. Please select the day again.",
    noSlotsToday: "There are currently no available times on this day.",
    appointmentSummary: "Appointment summary",
    duration: "Duration",
    noSuitableTime: "Could not find a suitable time?",
    waitlistExplain: "You can submit a waitlist request with your preferred date and time. The business can review it and contact you; this request does not reserve an appointment.",
    noBookingHours: "No opening hours are configured for appointments. You can join the waitlist or contact the business on WhatsApp.",
    waitlistSuccess: "Your request was added to the waitlist. The business can contact you; no appointment was booked.",
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
    appointmentBooking: "Записаться в календаре",
    businessNoHours: "Компания ещё не указала часы работы. Вы можете оставить заявку в лист ожидания или связаться через WhatsApp.",
    waitlistRequest: "Добавить в лист ожидания",
    whatsappContact: "Связаться через WhatsApp",
    continueWhatsApp: "Продолжить в WhatsApp",
    inquiryOnSite: "Оставить заявку на сайте",
    chooseOneMethod: "Выберите один способ продолжения для всех выбранных услуг.",
    productsInquiryNote: "Выбранные товары будут добавлены в заявку. Переход в WhatsApp не отправляет сообщение автоматически.",
    appointmentPhone: "Номер телефона для записи",
    back: "Назад",
    savingAppointment: "Сохраняем запись…",
    confirmAppointment: "Подтвердить запись",
    customerNameOptional: "Имя (необязательно)",
    phoneRequired: "Номер телефона *",
    emailOptional: "Электронная почта (необязательно)",
    saving: "Сохраняем…",
    sendInquiry: "Отправить заявку",
    preferredDate: "Предпочтительная дата *",
    preferredTimeOptional: "Предпочтительное время (необязательно)",
    noteOptional: "Примечание (необязательно)",
    fullName: "Полное имя",
    sendWaitlist: "Отправить заявку в лист ожидания",
    sending: "Отправляем…",
    backToCalendar: "Назад к календарю",
    monthNow: "Этот месяц",
    chooseDay: "Выберите день месяца",
    availableTimes: "Свободное время",
    morning: "Утро",
    afternoon: "День",
    evening: "Вечер",
    availableSlots: "Есть свободное время",
    unavailableDays: "Серые дни недоступны",
    checkingMonth: "Проверяем доступность на месяц…",
    monthLoadError: "Не удалось загрузить доступность на месяц. Обновите страницу.",
    chooseAvailableDay: "Выберите день, отмеченный как доступный.",
    checkingDaySlots: "Проверяем свободное время на выбранный день…",
    slotsLoadError: "Не удалось проверить время. Выберите день ещё раз.",
    noSlotsToday: "На этот день сейчас нет свободного времени.",
    appointmentSummary: "Информация о записи",
    duration: "Длительность",
    noSuitableTime: "Не нашли подходящее время?",
    waitlistExplain: "Вы можете оставить заявку в лист ожидания, указав предпочтительные дату и время. Компания проверит возможность и свяжется с вами; заявка не резервирует время в календаре.",
    noBookingHours: "Часы работы для записи не настроены. Вы можете оставить заявку в лист ожидания или связаться через WhatsApp.",
    waitlistSuccess: "Заявка добавлена в лист ожидания. Компания сможет связаться с вами; запись в календаре не создана.",
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
