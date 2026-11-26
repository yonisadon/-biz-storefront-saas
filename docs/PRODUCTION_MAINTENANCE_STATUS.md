# BTime — מצב תחזוקה ותשתיות Production

עודכן: 26.11.2026  
מקור אמת תפעולי: מסמך זה. מסמכי PR ותוכניות בדיקה היסטוריים אינם משקפים בהכרח את מצב Production הנוכחי.

## תקציר

- הושלמו שיפורי אמינות משמעותיים בקוד ובסכמות: retry מוגבל לחיבורי Registry/Tenant, cold-start handling ל-CRM cleanup, advisory locks, preflight לפני מחיקות, Push outbox ו-dispatch מיידי אחרי Commit.
- בבדיקת Railway ב-26.11.2026 כל חמשת השירותים ב-Production היו ללא התראות פעילות או פריסות כושלות ב-24 השעות האחרונות; לא נמצאה עבודה staged.
- API היה Online עם replica פעיל אחד. בדיקת המשתמש מאשרת שהתראות Push מגיעות בפועל למוכר וללקוח בהתאם לסטטוס התור.
- **חוסר פתוח:** קיים סקריפט Push recovery, אך אין שירות Cron פעיל שמריץ אותו מחזורית. אין לסמן את מנגנון ההתאוששות כמושלם עד שיוגדר ויאומת.
- Google Calendar נדחה ואינו חלק מתנאי סגירת התחזוקה הנוכחית.
- Media cleanup עדיין דורש פתרון Storage משותף/גישה בטוחה לנתוני המדיה.

## מצב שירותי Railway שנבדק

| שירות | תפקיד | מצב שנצפה |
|---|---|---|
| `-biz-storefront-saas` | API | Online, פריסה SUCCESS, replica אחד פעיל |
| `Postgres` | DB ראשי | Online |
| `crm-retention-cleanup` | Cron ניקוי CRM | Cron פעיל: `0 22,23 * * *` |
| `btime-google-calendar-worker` | Google Calendar | Online; עצם Online אינו מוכיח סנכרון תקין |
| `btime-temp-backup-postgres` | עותק DB זמני | Online; **תכולת העותק לא אומתה במסמך זה** |

לא נצפו התראות Railway פתוחות, כשלים/קריסות ב-24 השעות שנבדקו, או שינויים staged בסביבת Production.

### CRM cleanup

- פקודת ההפעלה: `npm run cleanup-expired-crm -- --apply`.
- לוגים מ-25.11 מראים שהריצה התאוששה מכשל חיבור Registry ראשוני (`ECONNREFUSED`) בניסיון השני.
- לאחר מכן preflight עבר לכל ארבעת מסדי העסקים וה-cleanup הסתיים בהצלחה.
- הריצה של 22:00 UTC דילגה לפי בדיקת השעה המקומית; הריצה של 23:01 UTC השלימה בהצלחה. זו התנהגות תואמת guard של שעה מקומית.

## Web Push — מצב נוכחי

### מה קיים ועובד

- המשתמש אישר קבלת התראות בפועל גם בצד המוכר וגם בצד הלקוח, בהתאם לסטטוס התור.
- שירות ה-API כולל את שמות חמשת משתני ההגדרה הנדרשים: `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY`, `WEB_PUSH_VAPID_SUBJECT`, `PUSH_SUBSCRIPTION_ENCRYPTION_KEY`, `PUSH_CAPABILITY_HMAC_KEY`. ערכי הסודות לא נקראו או תועדו.
- יצירת האירוע נשמרת ב-Outbox. לאחר Commit ה-API מנסה לבצע dispatch מיידי; כשל נרשם כ-dispatch שנדחה ל-Recovery.
- `backend/scripts/process-push-outbox.ts` קיים ומעבד tenants פעילים, עם PostgreSQL advisory lock כדי למנוע שתי ריצות Recovery מקבילות.
- `backend/src/pushService.ts` מממש backoff לשגיאות זמניות עד 8 ניסיונות; אירועים/מסירות נשארים ניתנים לעיבוד חוזר לפי מצבם.

### חוסר פתוח — Recovery מתוזמן

- ב-Railway לא נמצא Cron/Worker שמריץ `npm run process-push-outbox`.
- ב-`backend/package.json` קיימת הפקודה `process-push-outbox`, אך קיומה בקוד אינו מפעיל אותה.
- תכנית הבדיקות ההיסטורית הציעה Cron כל 30 דקות. זו המלצה לתצורה, לא תצורה פעילה.
- נדרש ליצור שירות Cron ייעודי (או מנגנון scheduler שקול) עם משתני DB ו-Push הנדרשים, להריץ את הסקריפט באופן מחזורי ולוודא בלוגים ריצות מוצלחות. יש להגדיר אותו כך שלא יפעיל את סקריפט הניקוי או יחליף את פקודת ה-API.
- עד שהשלב הזה יבוצע, שליחה מיידית יכולה לעבוד, אך הודעה שנדחתה ל-Recovery עלולה להישאר בתור עד ניסיון אחר/טיפול ידני.

## מסדי נתונים ומיגרציות

- לפי תוצאות ה-Postflight שנמסרו בתהליך התחזוקה ב-26.11.2026, מיגרציית ה-Platform Registry ומיגרציות ה-Tenant הוחלו על ארבעת העסקים, ובדיקות RLS/מבנה עברו.
- לא בוצעה כאן מיגרציה נוספת ולא שונו נתונים עסקיים.
- עותק Railway הזמני `btime-temp-backup-postgres` עדיין קיים. אין למחוק אותו עד לאימות מפורש של שלמותו והחלטה שאין בו עוד צורך.

## נושאים שנדחו / פתוחים

### Google Calendar

נדחה לפי החלטת מוצר. ה-Worker מופיע Online, אך אין להסיק מכך שהסנכרון עצמו עובד. אין לבצע שינוי בנושא עד חזרה יזומה לפרויקט Calendar.

### מחיקת מדיה ו-Storage

- ה-API משתמש ב-volume מקומי שמחובר ל-API תחת `/data`.
- שירות ה-CRM cleanup אינו מחובר לאותו volume.
- אין להגדיר בו `STORAGE_DRIVER=local` ולצפות שיוכל למחוק קבצים מה-volume של ה-API.
- יש להחליט על Storage משותף (למשל S3-compatible) או על מנגנון מחיקה בטוח שרץ במקום שבו קיימת גישה לקבצים. עד אז אין להפעיל retry של media cleanup באופן שעלול לדווח הצלחה בלי למחוק בפועל.

## סיכום לסגירת התחזוקה

אפשר לסמן את שיפורי האמינות, המיגרציות, ה-API וה-CRM cleanup כהושלמו לפי הבדיקות המתועדות. Push רגיל מאומת על ידי המשתמש. **התחזוקה התשתיתית אינה סגורה במלואה עד להוספת Cron ל-Push Recovery**. Media cleanup ו-Google Calendar נשארים מחוץ להיקף המיידי, כאשר Calendar נדחה במכוון.
