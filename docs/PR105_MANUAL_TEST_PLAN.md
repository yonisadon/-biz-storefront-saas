# PR #105 — תכנית בדיקות ידניות וקבלה

> המסמך הוא תכנית לביצוע לאחר הקמת סביבת בדיקות והגדרת secrets. הבדיקות המפורטות כאן עדיין לא בוצעו מול Railway או מכשיר Push אמיתי. אין להריץ בדיקות destructive ב-Production ללא אישור מפורש.

## 1. סדר הכנה

- [ ] סביבת בדיקות מבודדת עם Registry DB ו-Tenant DBs.
- [ ] Registry migration 006 הוחלה בהצלחה.
- [ ] Tenant migration 013 הוחלה על כל ה-tenants בסביבת הבדיקות.
- [ ] עסק חדש שנוצר אחרי המיגרציות קיבל Push entitlement=true ו-WhatsApp/SMS=false.
- [ ] אחרי provisioning מלא, כולל INSERT של tenant business row, קיימת גם רשומת `push_settings` עם ברירות המחדל seller_enabled/customer_enabled=true.
- [ ] הוגדרו secrets ב-backend: WEB_PUSH_VAPID_PUBLIC_KEY, WEB_PUSH_VAPID_PRIVATE_KEY, WEB_PUSH_VAPID_SUBJECT, PUSH_SUBSCRIPTION_ENCRYPTION_KEY, PUSH_CAPABILITY_HMAC_KEY.
- [ ] הוגדר Cron חיצוני ל-npm run process-push-outbox כל 30 דקות.
- [ ] נבדק ש-Service Worker מעודכן ופעיל ב-origin של סביבת הבדיקות.

## 2. Registry ו-Tenant migrations

- [ ] עסק קיים מקבל entitlement Push=true לאחר migration 006.
- [ ] עסק קיים עם entitlement שהוגדר ידנית לפני המיגרציה שומר על הערך הקיים (backfill אינו דורס).
- [ ] עסק חדש בהקמה עצמית מקבל Push=true.
- [ ] עסק חדש בהקמה על ידי סופר אדמין מקבל Push=true.
- [ ] שינוי entitlement דרך מסך סופר אדמין מתעדכן ב-Registry.
- [ ] חסימת Push לעסק מונעת רישום subscriptions ושליחה; העדפות מוכר נשמרות.
- [ ] החזרת entitlement מפעילה מחדש את ההעדפות שנשמרו.
- [ ] Tenant migration יוצרת את כל שש טבלאות Push, indexes, foreign keys, grants ו-RLS.
- [ ] tenant-schema.sql מקים את אותן טבלאות עבור tenant חדש.
- [ ] app_runtime אינו יכול לקרוא או לשנות נתוני tenant אחר.

## 3. הזמנה רגילה באתר — לקוח ומוכר

- [ ] יצירת הזמנה באתר יוצרת appointment ו-seller outbox event באותה transaction.
- [ ] המוכר מקבל Push רק אם entitlement והעדפת seller_enabled פעילים ויש subscription למוכר.
- [ ] יצירת הזמנה אינה שולחת Push ללקוח.
- [ ] מסך ההצלחה מציג opt-in ללקוח רק אם customer_enabled, entitlement והגדרות Push זמינות.
- [ ] אישור הרשאת דפדפן ללא לחיצה על opt-in להזמנה אינו יוצר consent להזמנה.
- [ ] opt-in מפורש יוצר `push_device_consents` לפי tenant+subscription וגם קישור target להזמנה A.
- [ ] הזמנה B מאותו דפדפן ואותו עסק מקושרת בשקט להסכמה הקיימת, ללא prompt נוסף.
- [ ] אותה הרשמת דפדפן בעסק אחר אינה מקבלת הסכמה אוטומטית לאותו עסק אחר.
- [ ] idempotent retry של אותה הזמנה מחזיר את אותו capability token; אין token גלוי ב-DB או בלוגים.
- [ ] עדכון אמיתי של תור אתר שולח Push ללקוח שהסכים לאותה הזמנה.
- [ ] ביטול דרך ניהול העסק שולח Push ללקוח שהסכים לאותה הזמנה.
- [ ] no-op update אינו יוצר event.
- [ ] תור ידני שנוצר על ידי המוכר אינו שולח Push ללקוח.
- [ ] מחיקה פיזית של תור אתר יוצרת cancellation event לפני DELETE; ה-consent נשמר למסירה.

## 4. רשימת המתנה

- [ ] בקשת המתנה חדשה יוצרת seller event ו-capability token, אך לא שולחת Push ללקוח כשהבקשה עדיין ממתינה.
- [ ] opt-in מפורש לבקשת המתנה יוצר הסכמה קבועה לפי tenant+subscription וקישור target מסוג waitlist.
- [ ] שיבוץ בקשת המתנה לתור מעביר capability ו-consent ל-target מסוג appointment.
- [ ] שיבוץ לאחר opt-in שולח customer.waitlist_scheduled.
- [ ] שיבוץ לפני opt-in משאיר את האירוע pending כל עוד capability בתוקף; opt-in מאוחר מפעיל ניסיון שליחה מיידי.
- [ ] ללא opt-in עד פקיעת capability, האירוע נסגר ללא שליחה ללקוח.
- [ ] עדכון/ביטול תור שנוצר מ-waitlist שולח Push רק אם consent קיים.
- [ ] מחיקת רשומת waitlist לאחר השיבוץ אינה שוברת את זיהוי מקור התור; capability marker נשאר על appointment.
- [ ] ביטול חוזר/no-op אינו יוצר הודעת ביטול נוספת.

## 5. העדפות, מכשירים ו-entitlement

- [ ] seller_enabled ו-customer_enabled ניתנים לשליטה בנפרד.
- [ ] כיבוי seller_enabled מונע הודעות למוכר אך אינו פוגע ב-customer subscriptions באותו דפדפן.
- [ ] הסרת מכשיר מקהל המוכר אינה קוראת ל-PushSubscription.unsubscribe ואינה מבטלת הסכמות לקוח נפרדות.
- [ ] כיבוי customer_enabled מונע opt-in חדש ושליחה ללקוחות.
- [ ] ביטול consent בעסק A אינו מבטל consent או subscriptions של אותו דפדפן בעסק B.
- [ ] ביטול consent ולאחריו הפעלה מחדש מאפשרים opt-in מפורש מחדש באותו דפדפן.
- [ ] הסרת entitlement על ידי סופר אדמין עוצרת שליחה בלי למחוק subscriptions או העדפות.
- [ ] החזרת entitlement מאפשרת שליחה עתידית לפי ההעדפות שנשמרו.
- [ ] 404/410 מהספק מנטרלים subscription.
- [ ] subscription לא תקף או consent שבוטל אינם משאירים delivery pending ללא סוף.
- [ ] endpoint לא מוכר או URL מקומי נדחה; אין SSRF לכתובת שרירותית.

## 6. Outbox ו-Recovery

- [ ] כשל Push אחרי COMMIT אינו מבטל הזמנה/שינוי תור.
- [ ] event שנשמר לפני קריסת התהליך נשלח בהרצת recovery הבאה.
- [ ] delivery עם timeout/network/408/429/5xx מקבל backoff עד 8 ניסיונות.
- [ ] 404/410 מנטרלים subscription; שגיאה קבועה מסיימת delivery כ-failed.
- [ ] שתי ריצות Cron מקבילות: רק אחת מחזיקה Registry advisory lock.
- [ ] event עם יותר מ-10 subscriptions ממשיך בבאצ'ים הבאים.
- [ ] event ללא recipients נסגר; waitlist-scheduled ממתין רק עד תוקף capability.
- [ ] נבדק חלון at-least-once: קריסה לאחר קבלת הודעה אצל ספק ולפני סימון sent עשויה לגרום לניסיון חוזר.
- [ ] נבדק ש-TTL אצל ספק Push הוא 24 שעות.
- [ ] נבדק ש-click על notification פותח רק URL מאותו origin.

## 7. Provisioning ומחיקת עסק

- [ ] יצירת עסק חדש יוצרת Registry business במצב suspended עד שכל משאבי tenant מוכנים.
- [ ] tenant DB חדש כולל schema, migrations, business row, `push_settings`, entitlement, access token וקישור `tenant_databases`.
- [ ] העסק מתפרסם כ-active רק לאחר שכל השלבים הושלמו.
- [ ] כשל בכל שלב אחרי יצירת Registry row מנסה למחוק את tenant DB ואת רשומות ה-Registry שנוצרו.
- [ ] כשל ב-compensating cleanup אינו נבלע: העסק נשאר suspended וממופה כך שניתן לזהות ולמחוק אותו בבטחה.
- [ ] retry לאחר כשל provisioning אינו יוצר DB, slug, access token או mapping כפולים.
- [ ] בקשת מחיקה מאושרת מקפיאה את העסק ומונעת שימוש בקישורי ניהול קיימים.
- [ ] שתי בקשות execute מקבילות לאותה בקשת מחיקה: רק אחת מבצעת מחיקה.
- [ ] manifest של database name וכל media storage variants נשמר לפני מחיקת storage או DB.
- [ ] כשל לאחר מחיקת storage, לאחר DROP DATABASE או במהלך מחיקת Registry ניתן להשלמה באמצעות retry.
- [ ] tenant DB חלקי ללא `media_assets` עדיין ניתן למחיקה בטוחה.
- [ ] אם קיים חיבור Google Calendar, המחיקה מבטלת את OAuth refresh token לפני DROP DATABASE; אירועים שכבר נוצרו נשארים ביומן Google, בהתאם להתנהגות ניתוק החיבור הקיימת.
- [ ] מחיקת עסק מסירה את tenant DB, media objects, tenant mapping, access tokens, domains, entitlements, subscriptions, owners ויתר רשומות ה-Registry התלויות לפי FK.
- [ ] אחרי מחיקה, slug, management link ו-session ישנים אינם פותחים את העסק.
- [ ] מחיקת עסק אחד אינה משנה נתונים או משאבים של עסק אחר.
- [ ] יצירת עסק חדש עם slug שהיה בשימוש בעסק שנמחק מתנהגת לפי מדיניות ה-slug הייחודית.

## 8. Cold start ו-CRM cleanup

- [ ] DB במצב sleep: גם אם חיבור PostgreSQL נפתח אך שאילתת `SELECT 1` ראשונה נכשלת זמנית, בדיקת readiness מתחברת מחדש; רק לאחר הצלחת probe נרכש advisory lock וה-cleanup ממשיך.
- [ ] כשל transient בשאילתת preflight של Tenant לאחר פתיחת החיבור גורם לחיבור מחדש ולניסיון חוזר; לא מתחילות מחיקות עד שכל ה-tenants עברו preflight.
- [ ] Preflight נכשל: אין מחיקות כלל.
- [ ] חיבור tenant נופל במהלך preflight: אין מחיקות כלל.
- [ ] שתי ריצות cleanup במקביל: השנייה אינה מבצעת cleanup במקביל.
- [ ] כשל במהלך שלב המחיקה אחרי ש-tenant קודם כבר ביצע COMMIT מתועד ככשל חלקי אפשרי בין מסדי tenants; אין הבטחה ל-global atomicity.
- [ ] dry-run מציג את אותן בחירות ללא מחיקה.
- [ ] retention days נלקחים מ-public.platform_retention_policies; לא קיימת תקופת retention hardcoded.
- [ ] Cron נכשל מחזיר exit code 1; הצלחה מחזירה 0.

## 9. Onboarding ו-regression

- [ ] מוכר חדש שנרשם עצמאית מגיע ל-Dashboard ורואה מדריך הקמה.
- [ ] עסק שהוקם על ידי סופר אדמין וחובר לחשבון מקבל אותה חוויית onboarding.
- [ ] התקדמות פרטי עסק, מוצרים, שעות וגלריה משקפת את הנתונים שנשמרו.
- [ ] אחרי הוספת מוצר/שירות, שעות או תמונות, התקדמות מתעדכנת לאחר רענון/ניווט.
- [ ] אפשר להסתיר מדריך ולהמשיך מאוחר יותר.
- [ ] לאחר סימון השלמה, המדריך נסגר אך נשארת אפשרות לפתוח אותו מחדש מכפתור הכותרת ("פתיחת מדריך ההקמה").
- [ ] הקישור הציבורי פותח את storefront של העסק; קישור הניהול נשאר פרטי.
- [ ] קישור הניהול נשאר קבוע לאחר login/logout.
- [ ] session רשום פג אחרי 3 ימים; logout מוחק את הסשן; login יוצר סשן חדש.
- [ ] אין שינוי בזרימת הקמת עסק קיימת, חיבור עסק לחשבון או redirect.
- [ ] בדיקת RTL, מובייל, focus, מקלדת ו-accessibility.

## 10. סטטוס ביצוע

- [x] Backend build/tests.
- [x] Web build/lint.
- [x] Validate.
- [x] Registry migration smoke.
- [x] Tenant migration smoke.
- [x] Platform account accessibility smoke.

בבדיקה על commit `6f66a99bdd25fb16c7a89eb36203df40360cac24` כל שש בדיקות ה-CI עברו, כולל לאחר תיקוני ה-review האחרונים.
- [ ] בדיקות ידניות בסביבת DB מבודדת.
- [ ] בדיקת Push אמיתית מול ספק ומכשיר.
- [ ] בדיקת CRM cleanup בזמן cold start/ניתוק.
- [ ] אימות Cron חיצוני ב-Railway.

