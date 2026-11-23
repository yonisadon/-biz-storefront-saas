# PR #105 — תוכנית מימוש, אמינות והדרכת מוכר

עודכן: 2026-11-23  
ענף עבודה: `docs/audit-auth-pwa-push-2026-11-22`  
מקור: בדיקת קוד `main` הנוכחי והקוד בענף PR #105. מסמך זה מפריד בין ממצאים שאומתו בקוד, החלטות מוצר שאושרו, ותכנון שעדיין דורש אימות/מימוש.

## סטטוס מימוש עדכני — 2026-11-23

הסעיפים ההיסטוריים בהמשך נשארים לצורכי הקשר. כאשר יש סתירה, סעיף הסטטוס הזה מתאר את הקוד הנוכחי בענף PR #105.

### CRM cleanup ו-cold start
- backend/scripts/cleanup-expired-crm.ts עודכן עם retry לחיבורי Registry/Tenant, retry ל-preflight, advisory lock, ושימוש חוזר בחיבורי tenant שעברו preflight.
- backend/src/db.ts כולל כעת retry מוגבל של עד 6 ניסיונות לחיבור Registry, לשליפת מיפוי tenant ולרכישת חיבור tenant. Transaction עסקי עצמו אינו מורץ מחדש אוטומטית לאחר שהתחיל, כדי לא להסתכן בביצוע כפול.
- לא שונו בחירת הרשומות, תקופות השמירה או public.platform_retention_policies.
- Backend build/tests עברו. בדיקות התרחישים המלאות של cold start וניתוק בזמן מחיקה עדיין דורשות סביבת DB ייעודית/הרצה מבוקרת.

### Web Push — מה כבר קיים בקוד
- Registry migration 006_platform_channel_entitlements.sql יוצרת platform_channel_entitlements, ממלאת Push=true לעסקים קיימים, ומוסיפה trigger שמייצר Push=true ו-WhatsApp/SMS=false לכל עסק חדש.
- Tenant migration tenant-013-web-push.sql מוסיפה:
  - push_settings — העדפות מוכר/לקוחות, ברירת מחדל true.
  - push_subscriptions — subscriptions לפי קהל, endpoint ו-key material מוצפנים.
  - push_booking_capabilities — hash token, יעד, תוקף של 7 ימים, וה-subscription היחיד שאושר עבור אותה הזמנה/בקשת המתנה.
  - push_consents — קשר בין subscription לבין הזמנה/בקשת המתנה ספציפית. אין FK ליעד כדי לשמר את הקשר גם לאחר מחיקה פיזית של תור.
  - push_outbox ו-push_deliveries — אירועים, ניסיונות מסירה, leases, backoff ומפתח ייחודי event+subscription.
- tenant-schema.sql עודכן גם להקמת DB חדש. tenantMigrations.ts מגלה את migration 013 לפי מנגנון ה-migration הקיים; אין שינוי ידני ל-ledger.
- נוצרה ספריית Web Push מבוססת node:crypto ללא תלות npm חיצונית: VAPID ES256, הצפנת payload לפי aes128gcm, הצפנת secrets במנוחה AES-256-GCM, ו-hash ל-capability token.
- נוצרו בדיקות יחידה לחתימת VAPID, round-trip של הצפנת payload, הצפנת secrets וזיהוי שינוי token.
- נוספו endpoints ציבוריים לטעינת Push config ולהסכמה להזמנה ספציפית; endpoints למוכר לשליטה בהעדפות ולרישום/הסרת מכשיר; ו-endpoints לסופר אדמין לשליטה בהרשאת Push לעסק.
- ה-Service Worker מטפל באירוע push ובלחיצה על notification, תוך הגבלת קישור היעד לאותו origin.
- OrderSection מציע opt-in נפרד לאחר הזמנה או בקשת המתנה. הרשאת דפדפן פעילה אינה יוצרת consent בפני עצמה.
- אירועי outbox נרשמים בתוך transaction של הפעולה העסקית. לאחר COMMIT נעשה ניסיון שליחה מוגבל; כשל אינו מבטל את ההזמנה. recovery command נוסף: npm run process-push-outbox, עם advisory lock ו-processing לפי tenant.
- נוספה פקודה ליצירת VAPID/encryption keys: npm run generate-web-push-keys. המפתחות עדיין אינם מוגדרים ב-Railway, ולא בוצעה שליחה אמיתית לספק Push או למכשיר.
- בדיקות smoke למיגרציות Registry ו-Tenant נוספו ועברו. כל בדיקות CI עברו ב-commit 3546f2d: Backend build/tests, Web build/lint, Validate, Registry migration smoke, Tenant migration smoke ו-Platform account accessibility smoke.
- מגבלת exactly-once: unique delivery key ו-leases מונעים כפילות רגילה. אם ספק Push קיבל הודעה והתהליך נפל לפני עדכון sent ב-DB, recovery עלול לשלוח שוב. ספקי Push סטנדרטיים אינם מספקים idempotency key כללי שמאפשר הבטחת exactly-once; לכן ההתנהגות היא at-least-once עם חלון קטן לכפילות, ולא הבטחה מוחלטת לאפס כפילויות.

### Onboarding למוכר
- Dashboard כולל checklist עם מצב שמחושב מנתוני פרטי העסק, מוצרים פעילים, שעות פעילות וגלריה.
- הובהר ההבדל בין קישור ציבורי ללקוחות לבין אזור הניהול הפרטי.
- אפשר לדלג, להמשיך מאוחר יותר ולהציג שוב את מדריך ההקמה גם אחרי סימון ההשלמה.
- לא שונו קישור הניהול הקבוע, session של 3 ימים, login/logout או מסלולי יצירת העסק.
- שדרוג ה-UI הוכנס; Web build/lint ו-Platform account accessibility smoke עברו.

### מה עדיין לא אומת בסביבת Production
- לא הורצו migrations 006/tenant-013 ב-Production.
- לא הוגדרו VAPID/encryption secrets ב-Railway.
- לא הוגדר/אומת Cron של process-push-outbox ב-Railway. נדרש להגדירו חיצונית כל 30 דקות; אין לטעון שהוא פעיל לפני בדיקה.
- לא בוצעו Deploy או בדיקת Push אמיתית בדפדפן/מכשיר.
- אין שינוי production או migration שבוצעו במסגרת העבודה הנוכחית.


## 1. גבולות עבודה והחלטות שאסור לשנות

- כל העבודה נשארת ב-PR #105. אין לפתוח PR נוסף עבור אותם נושאים.
- אין למזג ל-`main`, להריץ מיגרציות production, לפרוס ל-Railway/Vercel או לשנות Cron/Variables בסביבת Railway ללא אישור מפורש.
- לא משנים את מדיניות retention, תקופות השמירה, סוגי הרשומות או מקור המדיניות `public.platform_retention_policies`.
- קישור הניהול של המוכר נשאר קבוע. סשן החשבון הוא 3 ימים. אין ליצור קישור ניהול חדש בכל כניסה ואין לשנות את ה-URL הקבוע.
- התנהגות PWA שכבר נבדקה על ידי בעל המוצר נשמרת; העבודה הנוכחית מוסיפה Push ואינה מחליפה את מנגנון ההתקנה.
- אין לשנות את היכולת הקיימת של לקוח לבקש תור/להצטרף לרשימת המתנה, ואין להוסיף בשלב זה ביטול או שינוי תור עצמאי מצד לקוח.

## 2. תיקון מצב התיעוד ההיסטורי

חלקים ותיקים ב-`SYSTEM_SPEC.md` מתארים מצב שהיה נכון בזמן כתיבתם: קישור ניהול מתחלף, תוקף של 8 שעות, סשן של 14 יום, או היעדר Service Worker. אלה אינם תיאור של המצב הנוכחי. אין למחוק היסטוריה טכנית, אך יש להתייחס לסעיפי audit ישנים כאל תמונת מצב היסטורית בלבד.

מצב נוכחי שאומת בקוד:
- מיגרציית Registry `004_management_access_and_encrypted_tokens.sql` תומכת ב-token ניהול קבוע ומוצפן.
- מיגרציית Registry `005_seller_onboarding_state.sql` מוסיפה `businesses.onboarding_completed_at`.
- קיים Service Worker ב-`web/public/sw.js`; כרגע הוא מטפל ב-shell/offline בלבד ואינו מכיל מאזיני Push.
- קיים מסך Onboarding בסיסי ב-`web/components/manage/Dashboard.tsx`.
- משך הסשן הנוכחי שנקבע במוצר הוא 3 ימים, בהתאם לשינויים שמוזגו ב-PR #106. אין להעתיק את ערכי 8 שעות/14 יום ממסמכי audit קודמים.

## 3. ארכיטקטורת הנתונים הקיימת — גבולות Registry ו-Tenant

### Registry מרכזי
ה-Registry הוא מקור האמת למידע פלטפורמה ולמיפוי מסדי עסקים:
- `app.tenant_databases`: מיפוי tenant למסד הנתונים הייעודי שלו.
- `public.businesses`: רישום מרכזי של עסקים ופרטי פלטפורמה.
- `public.platform_business_owners`: שיוך בעל חשבון לעסק.
- `public.platform_subscriptions`: מסלול/סטטוס מנוי.
- `public.access_tokens` ו-`public.platform_sessions`: קישור ניהול וסשני חשבון.
- `public.platform_retention_policies`: מדיניות retention מרכזית. משימת הניקוי קוראת ממנה ואסור להחליף אותה בערכים מקודדים.

### מסד Tenant נפרד לכל עסק
כל עסק משתמש במסד ייעודי בשם הצפוי `biz_<tenant-id ללא מקפים, עד 24 תווים>`. `backend/src/db.ts` מאמת שהמיפוי ב-Registry תואם לשם הצפוי ונכשל סגור אם אין התאמה. נתוני העסק נשמרים במסד tenant ולא ב-Registry:
- `businesses`, `products`, `leads`, `appointments`, `waitlist_entries`, טבלאות מדיה, חסימות יומן וטבלאות אינטגרציה.
- `tenant_schema_migrations` מתעד את המיגרציות שהוחלו בכל מסד tenant.

### מסלולי מיגרציה קיימים
- Registry: רשימת קובצי המיגרציה מוגדרת במפורש ב-`backend/scripts/migrate-platform-registry.ts`; יש לעדכן גם את הרשימה וגם את קובצי SQL.
- Tenant: `backend/src/tenantMigrations.ts` מגלה קבצים לפי התבנית `tenant-NNN-*.sql` ומחיל כל קובץ פעם אחת לפי ledger.
- הקמת עסק עצמאי ב-`backend/src/provisioning.ts` יוצרת DB, מריצה `tenant-schema.sql`, ואז `applyTenantMigrations`, ורק לאחר מכן משלימה מיפוי/בעלות/קישור ניהול/מנוי ב-Registry.
- לפני הוספת Push יש לבדוק גם מסלולי הקמה נוספים (למשל הקמה על ידי סופר אדמין), ולא להניח ש-`provisionBusinessForOwner` הוא המסלול היחיד.

## 4. CRM cleanup — תיקון cold start ואמינות

### ממצאים שאומתו
- השירות: `backend/scripts/cleanup-expired-crm.ts`; הפקודה: `npm run cleanup-expired-crm`.
- לפני התיקון השירות התחבר ל-Registry ולכל tenant ללא retry.
- הוא ביצע preflight לכל tenant, סגר את החיבור, ואז התחבר מחדש לכל tenant בשלב המחיקה. לכן הצלחת preflight לא הבטיחה שהחיבור החדש בשלב המחיקה יצליח.
- כל tenant נמחק בתוך transaction נפרד. אין transaction אטומי אחד על פני כל מסדי העסקים.
- מדיניות retention נשלפת מ-`public.platform_retention_policies`; השאילתות והתקופות נשארות ללא שינוי.
- כשל כללי מסתיים ב-exit code 1. אין לשנות זאת לכשל שקט.

### שינוי שבוצע בענף PR #105
- נוספו עד 12 ניסיונות חיבור עבור שגיאות PostgreSQL זמניות, עם השהיה מדורגת ומוגבלת (עד 5 שניות בין ניסיונות).
- נוספה נעילת PostgreSQL advisory ברמת Registry כדי למנוע שתי ריצות מקבילות.
- חיבורי tenant שנפתחו ועברו preflight נשמרים פתוחים ומשמשים גם בשלב העבודה, במקום לסגור ולהתחבר מחדש בין השלבים.
- כשל preflight עוצר לפני תחילת מחיקות; שגיאות preflight ושגיאות מחיקה מקבלות הקשר שונה בלוג.
- לא נוספה מיגרציה ולא שונתה מדיניות retention.

### מגבלות שצריך להציג ביושר
כל tenant מתבצע ב-transaction נפרד. אם חיבור נופל באמצע שלב המחיקה לאחר שעסק קודם כבר ביצע COMMIT, לא ניתן להבטיח rollback גלובלי לעסקים קודמים ללא מנגנון טרנזקציות מבוזרות. התיקון מונע התחלת מחיקות לפני שכל החיבורים וה-preflight הצליחו, ומצמצם את חלון הכשל; הוא אינו מבטיח אטומיות בין מסדי נתונים נפרדים. מחיקה חוזרת נשארת idempotent מבחינת הרשומות שכבר נמחקו.

### בדיקות נדרשות
- כשל זמני בחיבור Registry ולאחריו הצלחה.
- כשל זמני בחיבור tenant ולאחריו הצלחה.
- כשל preflight ב-tenant כלשהו: לוודא שלא החלה מחיקה באף tenant.
- שתי ריצות במקביל: השנייה מדלגת באופן מסודר ואינה מוחקת.
- כשל במהלך transaction של tenant: rollback של אותו tenant ו-exit code 1.
- Dry-run אינו משנה נתונים.
- Apply חוזר אינו מייצר שגיאות או מחיקות לא צפויות.
- השוואת שאילתות selection/retention לפני ואחרי כדי להבטיח שלא השתנו.

## 5. Web Push — החלטות מוצר מאושרות

### שלוש שכבות הרשאה נפרדות
1. Entitlement של הערוץ לעסק — בשליטת סופר אדמין ב-Registry. Push מאושר כברירת מחדל לעסקים חדשים וקיימים; WhatsApp/SMS לא נשלחים בשלב זה.
2. העדפת העסק — המוכר יכול להפעיל/לכבות בנפרד Push למוכר ו-Push ללקוחות. ברירת המחדל לשניהם פעילה. העדפת מוכר אינה יכולה לעקוף entitlement שהוסר.
3. הרשאת הנמען — הרשאת הדפדפן/המכשיר, ובמקרה של לקוח גם הסכמה מפורשת להזמנה/בקשת ההמתנה הספציפית.

### הסכמת לקוח להזמנה מסוימת
- הרשאת Push כללית בדפדפן אינה מספיקה.
- כל הזמנה וכל בקשת המתנה דורשת opt-in מפורש ונפרד.
- ההצעה ל-opt-in תופיע לאחר הצלחה, במסך האישור; לחיצה מפורשת תפעיל בקשת הרשאה בדפדפן, יצירת subscription וקישור להזמנה.
- לא משתמשים בטלפון לבדו כדי לזהות/לאשר לקוח. בשלב ראשון אין אימות טלפון, אין מכשירים נוספים ואין self-service לשינוי/ביטול תור.
- נדרש capability token אקראי לכל הזמנה/בקשת המתנה, כאשר ב-DB נשמר hash בלבד ותוקף. token גולמי לא נכתב ללוגים.
- אם יש idempotency retry, יש להחזיר את אותו capability פעיל ולא להפיק token חדש שאינו מקושר לרשומה.

### אירועים בשלב הראשון
| קהל | אירוע | שליחה |
|---|---|---|
| מוכר | הזמנה חדשה באתר | כן, אם entitlement והעדפת מוכר פעילים |
| מוכר | בקשת המתנה חדשה | כן, אם entitlement והעדפת מוכר פעילים |
| לקוח | בקשת המתנה שובצה לתור | כן, רק אם opt-in תקף לבקשת ההמתנה |
| לקוח | שינוי/ביטול תור שנקבע באתר | כן, רק אם opt-in תקף להזמנה |
| לקוח | שינוי/ביטול תור שנוצר משיבוץ המתנה | כן, רק אם ההסכמה של בקשת ההמתנה הועברה לתור |
| לקוח | יצירת תור רגיל באתר | לא |
| לקוח | תור ידני שהמוכר יצר ביומן | לא |
| לקוח | בקשת המתנה שעדיין ממתינה | לא |
| לקוח | שינוי/ביטול עצמאי | לא קיים בשלב זה |

אין להסתמך על `appointments.source` לזיהוי תור שמקורו בבקשת המתנה: מסלול השיבוץ הקיים שומר `source='manual'`. יש להשתמש בקשר `waitlist_entries.appointment_id` או בשדה מקור מפורש ומתועד.

### אבטחה ופרטיות
- subscription endpoint וערכי p256dh/auth הם סודות; יש להצפין במנוחה עם AES-256-GCM או מנגנון שקול, באמצעות מפתח ייעודי ב-Environment.
- אין לשמור מידע אישי רגיש בגוף Push. להשתמש בכותרת/תוכן כלליים וקישור למסך מאומת.
- 404/410 מספק Push מסמנים subscription לא תקף ויש לנקות/לנטרל אותו באופן בטוח.
- קבלת תשובה מספק Push אינה הוכחה שהמכשיר הציג התראה.
- הסכמת Push תפעולית אינה הסכמה שיווקית לדוא"ל/SMS.

## 6. Web Push — סכימה ומימוש בענף PR #105

### Registry
- Registry migration 006_platform_channel_entitlements.sql מוסיפה את הטבלה platform_channel_entitlements עם מפתח (tenant_id, channel), enabled, updated_at ו-updated_by.
- המיגרציה מבצעת backfill לעסקים קיימים: Push=true, WhatsApp=false, SMS=false.
- trigger על public.businesses מייצר אותן ברירות מחדל לכל עסק חדש. כך גם הקמה עצמית וגם הקמה על ידי סופר אדמין מקבלות אותה הרשאה בלי לוגיקה כפולה במסלולי provisioning.
- app_runtime מקבל SELECT בלבד; app_superadmin מקבל SELECT/INSERT/UPDATE. מסך סופר אדמין מאפשר להפעיל/לחסום Push לעסק בנפרד.
- ה-Registry אינו שומר subscriptions, consent או payload עסקי.

### Tenant — migration 013 ו-tenant-schema.sql
- push_settings: שורה לכל tenant; seller_enabled ו-customer_enabled ברירת מחדל true.
- push_subscriptions: audience seller/customer, endpoint_hash ייחודי, ו-endpoint/p256dh/auth מוצפנים במנוחה. subscriptions מנותקים מסומנים disabled_at.
- push_booking_capabilities: target_type/target_id, token_hash, expires_at, opted_in_at, revoked_at ו-subscription_id. capability תקף 7 ימים ומאפשר subscription יחיד עבור אותה הזמנה/בקשת המתנה.
- push_consents: קשר בין subscription לבין target_type/target_id. אין FK לרשומת appointment/waitlist בכוונה, כדי שה-consent יישאר זמין למסירת אירוע ביטול גם לאחר DELETE פיזי של appointment.
- push_outbox: audience, event_type, target_type/target_id, payload מינימלי, status, attempts, next_attempt_at, locked_until ו-last_error.
- push_deliveries: קשר ייחודי בין outbox event ל-subscription, status, attempts, lease, next_attempt_at, provider_status_code ו-sent_at.
- כל הטבלאות כוללות tenant_id, RLS ו-FORCE RLS. app_runtime מקבל הרשאות CRUD רק בתוך tenant context.
- tenant-schema.sql כולל את אותן טבלאות עבור DB חדש; tenant-013-web-push.sql מחיל אותן על DB קיים. tenantMigrations.ts מגלה את הקובץ לפי מספור, וה-runner מנהל את transaction ואת ledger. אין BEGIN/COMMIT פנימיים בקובץ migration tenant.

### Capability ו-consent
- לאחר יצירת הזמנה באתר או בקשת המתנה, נוצר token של 32 bytes נגזר ב-HMAC-SHA256 מ-UUID אקראי של capability, מזהי tenant/target, תוקף ומפתח שרת ייעודי; ב-DB נשמר SHA-256 בלבד. כך idempotent retry יכול להחזיר בדיוק את אותו token בלי לשמור token גלוי או מוצפן. token מוחזר למסך ההצלחה, לא ללוגים.
- opt-in מתבצע רק בלחיצה מפורשת: Notification permission, רישום Service Worker, PushManager subscription, ואז POST עם token להזמנה הספציפית.
- token לא תקף להזמנה אחרת. כל הזמנה וכל בקשת המתנה דורשת opt-in נפרד. אותו subscription בדפדפן יכול להיות מקושר בנפרד למספר הזמנות אם בוצעה הסכמה נפרדת לכל אחת.
- עבור capability יחיד נשמר subscription אחד. רישום מכשירים נוספים לאותה הזמנה נדחה לשלב עתידי.
- בעת שיבוץ waitlist ל-appointment, גם capability וגם consent מועברים ל-target של appointment. בעת מחיקה פיזית של תור capability לא מנוצל מבוטל, אך consent קיים נשמר למסירת אירוע הביטול.
- אם בקשת המתנה שובצה לפני שהלקוח הספיק לבצע opt-in, אירוע השיבוץ נשאר pending כל עוד capability בתוקף; לאחר opt-in מאוחר מתבצע ניסיון שליחה מיידי. לאחר פקיעת capability ללא consent האירוע נסגר ללא שליחה.

### אירועים
- seller.appointment_created: רק כאשר נוצר appointment חדש במסלול הציבורי; לא נוצר באידמפוטנט duplicate.
- seller.waitlist_created: בקשת המתנה חדשה.
- customer.waitlist_scheduled: שיבוץ בקשת המתנה לתור.
- customer.appointment_updated: שינוי אמיתי בפרטי תור שהלקוח קבע באתר או תור שנוצר משיבוץ waitlist, ורק אם קיימת consent להזמנה.
- customer.appointment_cancelled: ביטול או מחיקה פיזית של תור מזכה, ורק אם קיימת consent להזמנה.
- אין Push ללקוח בעת יצירת תור רגיל, לתור ידני ללא קשר waitlist, לבקשת המתנה שעדיין ממתינה, או על no-op update.
- זיהוי תור waitlist מבוסס על waitlist_entries.appointment_id, ולא על appointments.source, משום שתור משובץ מקבל source='manual'.

### Transactional outbox ושליחה
1. אירוע outbox נרשם באותה transaction של יצירת/שינוי/ביטול הפעולה העסקית.
2. רק לאחר COMMIT מבוצע ניסיון שליחה מיידי ומוגבל; כשל Push אינו מבטל את הפעולה העסקית.
3. אין fire-and-forget לא ממתין מתוך בקשת Serverless.
4. pushService.ts טוען entitlement והעדפות, יוצר deliveries ייחודיים, נועל event/delivery באמצעות leases, ושולח עד 10 deliveries בכל מעבר.
5. sendWebPush משתמש ב-timeout של 8 שניות. כשלי ספק זמניים (network/408/429/5xx) מקבלים עד 8 ניסיונות עם backoff עד 6 שעות; 404/410 מנטרלים subscription.
6. recovery command: npm run process-push-outbox. הוא עובר על tenants, מחזיק Registry advisory lock כדי למנוע ריצות Cron מקבילות, ומעבד pending/expired leases. התכנון הוא Cron חיצוני כל 30 דקות.
7. אם אין recipients, האירוע נסגר ללא שליחה. אם אין הגדרת VAPID אך קיימים recipients, האירוע נשאר pending עד ניסיון recovery נוסף.
8. אם DB אינו זמין ולא ניתן לבצע COMMIT, אין להחזיר הצלחה לפעולה העסקית.

### Delivery guarantee — מגבלה ידועה
מפתח UNIQUE (tenant_id, outbox_id, subscription_id) ו-leases מונעים יצירת delivery כפולה ומצמצמים כפילויות בזמן concurrency. עם זאת, אם ספק Push קיבל את ההודעה והתהליך נפל לפני עדכון status='sent' ב-DB, recovery עלול לשלוח שוב. ספקי Push סטנדרטיים אינם מספקים idempotency key כללי; לכן ההבטחה היא at-least-once עם חלון קטן לכפילות, ולא exactly-once.

### אבטחה והגדרות
- pushCrypto.ts משתמש ב-node:crypto: VAPID ES256, RFC 8291 aes128gcm, AES-256-GCM להצפנת secrets, ו-SHA-256 ל-capability/endpoint hash.
- endpoint מוגבל לספקי Push מוכרים ב-HTTPS כדי לצמצם SSRF. payloads כלליים ואינם כוללים שם/טלפון/פרטי תור.
- Environment נדרש ב-backend: WEB_PUSH_VAPID_PUBLIC_KEY, WEB_PUSH_VAPID_PRIVATE_KEY, WEB_PUSH_VAPID_SUBJECT, PUSH_SUBSCRIPTION_ENCRYPTION_KEY ו-PUSH_CAPABILITY_HMAC_KEY.
- יצירת מפתחות מקומית: npm run generate-web-push-keys. אין לשמור מפתחות ב-repository.
- ה-Service Worker ב-web/public/sw.js מציג notification ומגביל notificationclick לכתובת באותו origin; מדיניות cache/offline הקיימת לא שונתה.
- אין עדיין הגדרת VAPID secrets ב-Railway, אין בדיקת ספק/מכשיר אמיתית, וה-Cron החיצוני לא אומת. אין לטעון שהערוץ פעיל ב-production.

## 7. Cold start — Push API ו-Recovery

- backend/src/db.ts כולל connectionTimeoutMillis של 5000ms ב-Registry pool ו-retry של עד 6 ניסיונות לחיבור Registry, לשליפת מיפוי tenant ולרכישת חיבור tenant. ההשהיה מדורגת מ-250ms עד 3000ms.
- retry אינו מריץ מחדש callback עסקי או transaction שכבר התחיל. כך נמנעת סכנת ביצוע כפול כאשר לא ידוע אם COMMIT הצליח.
- process-push-outbox.ts משתמש ב-connectRegistryWithRetry, advisory lock גלובלי, עיבוד לפי tenant, exit code 1 כאשר tenant נכשל, וסגירת pools בסיום.
- Recovery מתוכנן ל-Cron חיצוני כל 30 דקות. הגדרת Cron ב-Railway אינה ב-repository ולא אומתה דרך ההרשאות הזמינות; אין לטעון שהיא קיימת או לשנות אותה ללא אישור.
- אם cold start לא מסתיים במסגרת retry/timeouts, הפעולה העסקית לא מדווחת כהצלחה אם לא בוצע COMMIT; אירוע outbox שכבר נשמר נשאר זמין ל-recovery.

## 8. Onboarding — מצב קיים ושדרוג שבוצע

### מצב קיים שאומת
- Registry migration 005_seller_onboarding_state.sql מוסיפה businesses.onboarding_completed_at.
- manage.ts כולל GET לפרטי העסק ו-POST /onboarding/complete.
- ב-Dashboard היה checklist בסיסי ללא חישוב התקדמות לפי הנתונים.

### מה שודרג בענף
- checklist מציג ארבעה שלבים: פרטי עסק, מוצרים/שירותים, שעות פעילות, תמונות/גלריה.
- מצב ההתקדמות מחושב מנתוני העסק, מספר מוצרים פעילים, שעות פעילות וגלריה — ולא רק מסימון ידני.
- נוסף הסבר בולט שמבדיל בין קישור ציבורי ללקוחות לבין אזור הניהול הפרטי, יחד עם פתיחת האתר והעתקת קישור הלקוחות.
- אפשר להסתיר את ההדרכה, להמשיך מאוחר יותר, ולהציג אותה שוב גם לאחר סימון השלמה.
- נשמרים הקישור הקבוע, session של 3 ימים, login/logout, redirect והזרימות הקיימות.
- לא נוספה מיגרציה ולא אופס onboarding_completed_at לעסקים קיימים.
- מסך הצלחה נפרד מיד לאחר יצירת העסק עדיין לא שונה; השיפור ממוקד בחוויית הכניסה הראשונה ל-Dashboard ובהדרכה שבתוכו.

### בדיקות קבלה שנותרו
- לוודא שהתקדמות מתעדכנת לאחר שמירת מוצרים/גלריה ושעות, ולא רק לאחר ניווט/רענון.
- עסק חדש אחרי הרשמה עצמית ועסק שהוקם על ידי סופר אדמין ומחובר לחשבון.
- עסק קיים לא מאבד נתונים/קישור/הגדרות; אפשר לפתוח שוב את המדריך.
- קישור לקוחות פותח /biz/<slug>; קישור ניהול נשאר פרטי ויציב.
- מובייל, RTL, נגישות מקלדת ו-focus.

## 9. שלבי ביצוע ו-gates

| שלב | עבודה | סטטוס / תנאי מעבר |
|---|---|---|
| A | Audit של מסלולי יצירת עסק, אירועי תור/המתנה, סכימות ו-Cron | הושלם בקוד ובתיעוד; Cron חיצוני לא אומת |
| B | CRM cleanup cold-start ו-concurrency | הקוד ו-Backend CI עברו; בדיקת cold start/ניתוק חיה עדיין נדרשת |
| C | SQL ל-Registry ול-Tenant, backfill, defaults ו-RLS | מימוש הושלם; Registry ו-Tenant migration smoke tests נוספו |
| D | VAPID, subscriptions, entitlement והעדפות מוכר | מימוש הושלם; בדיקות crypto ו-Backend CI עברו |
| E | capability tokens ו-opt-in להזמנה/המתנה | מימוש הושלם בקוד; בדיקת דפדפן/מכשיר אמיתית עדיין נדרשת |
| F | outbox, dispatch מיידי ו-Cron recovery | מימוש הושלם בקוד; Cron Railway טרם הוגדר/אומת; at-least-once מתועד |
| G | UI opt-in ללקוח והגדרות Push למוכר/סופר אדמין | מימוש הוכנס; ממתין לאימות Web build/Validate האחרון ולבדיקה ידנית |
| H | שיפור onboarding והדרכת מוכר | checklist, progress, קישורים, דילוג וחזרה הוכנסו; נדרשת בדיקת קבלה ידנית |
| I | בדיקות מלאות ועדכון מסמכים/PR description | בתהליך; אין לסמן הושלם עד שכל CI עובר והבדיקות הידניות מתועדות |

## 10. סטטוס נכון לעדכון זה

- [x] החלטות מוצר Web Push והסכמת לקוח תועדו.
- [x] נמצאה ותועדה אי-התאמה בתיעוד ההיסטורי של session/PWA.
- [x] CRM cleanup כולל retry/preflight retry, advisory lock ושימוש חוזר בחיבורי tenant; Backend CI עבר.
- [x] נוספו retries מוגבלים ל-Registry ולרכישת חיבור tenant ב-db.ts; אין retry אוטומטי ל-transaction שכבר התחיל.
- [x] זוהו מסלולי provisioning עצמאי וסופר אדמין; entitlement defaults מרוכזים ב-trigger של Registry כדי ששניהם יקבלו אותה ברירת מחדל.
- [x] Registry migration 006 ו-Tenant migration 013 נוספו; tenant-schema.sql עודכן; נוספו migration smoke tests.
- [x] נוספו crypto helpers ובדיקות VAPID/encryption/capability.
- [x] נוספו public consent API, seller settings/subscription API, Super Admin entitlement API/UI, outbox dispatch ו-recovery command.
- [x] נוספו אירועי seller booking/waitlist ולקוח update/cancel, כולל העברת waitlist consent לתור וזיהוי תור waitlist לפי הקשר ולא לפי appointments.source.
- [x] Service Worker ו-UI opt-in ללקוח/מוכר נוספו.
- [x] Onboarding Dashboard שודרג עם progress, הבחנה בין קישורים, דילוג, חזרה והצגה מחדש.
- [x] Backend build/tests ו-Tenant migration smoke עברו ב-commit 8559b77; בדיקות Registry smoke עברו ב-commit קודם. Web build, Validate, Registry migration smoke ו-Platform account accessibility smoke עברו ב-commit 3546f2d.
- [ ] נדרשות בדיקות קבלה ידניות של Push בדפדפנים/מכשירים ושל תרחישי cold start/CRM cleanup.
- [ ] נדרשת הגדרת VAPID/encryption secrets ו-Cron חיצוני ב-Railway לאחר אישור נפרד; לא בוצעו שינויים כאלה.
- [ ] לא בוצעו מיגרציות Production, Deploy או שינויי Railway במסגרת העבודה הזאת.
