'use client';

import { FormEvent, useState } from 'react';

type CreatedBusiness = {
  id: string;
  name: string;
  slug: string;
  database: string;
  public_url: string;
  management_url: string;
  status: string;
};

export default function PlatformAdminPage() {
  const [adminToken, setAdminToken] = useState('');
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [phone, setPhone] = useState('');
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<CreatedBusiness | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError('');
    setCreated(null);
    try {
      const response = await fetch('/api/admin/businesses', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${adminToken.trim()}`,
        },
        body: JSON.stringify({
          name,
          slug,
          ...(phone.trim() ? { phone: phone.trim() } : {}),
          ...(whatsappNumber.trim() ? { whatsapp_number: whatsappNumber.trim() } : {}),
          ...(email.trim() ? { email: email.trim() } : {}),
        }),
        cache: 'no-store',
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const messages: Record<string, string> = {
          unauthorized: 'מפתח הניהול אינו נכון.',
          admin_not_configured: 'מפתח הניהול לא הוגדר בשרת.',
          provisioning_not_configured: 'חסרות הגדרות מסד הנתונים או כתובת האתר בשרת.',
          slug_already_exists: 'כתובת האתר הזו כבר תפוסה.',
          invalid_il_phone: 'יש להזין מספר טלפון ישראלי תקין.',
          business_provisioning_failed: 'יצירת העסק נכשלה. בדוק את לוג השרת לפני ניסיון חוזר.',
        };
        throw new Error(messages[data?.error] ?? data?.message ?? 'לא ניתן ליצור את העסק כרגע.');
      }
      setCreated(data as CreatedBusiness);
      setName('');
      setSlug('');
      setPhone('');
      setWhatsappNumber('');
      setEmail('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'אירעה שגיאה לא צפויה.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900 sm:px-6">
      <div className="mx-auto max-w-2xl">
        <header className="mb-8">
          <p className="mb-2 text-sm font-semibold text-blue-700">ניהול פלטפורמה</p>
          <h1 className="text-3xl font-bold tracking-tight">יצירת עסק חדש</h1>
          <p className="mt-3 leading-7 text-slate-600">
            כל עסק חדש יקבל מסד PostgreSQL נפרד בתוך שירות Railway הקיים, אתר ציבורי וקישור ניהול פרטי.
          </p>
        </header>

        <form onSubmit={submit} className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <div>
            <label htmlFor="adminToken" className="mb-2 block text-sm font-semibold">מפתח ניהול הפלטפורמה</label>
            <input id="adminToken" type="password" autoComplete="off" required minLength={32}
              value={adminToken} onChange={(e) => setAdminToken(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-3 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
              placeholder="הדבק כאן את SUPERADMIN_API_TOKEN" />
            <p className="mt-1 text-xs text-slate-500">המפתח נשמר בזיכרון הדף בלבד ולא נשלח לשום מקום מלבד השרת שלך.</p>
          </div>

          <div>
            <label htmlFor="name" className="mb-2 block text-sm font-semibold">שם העסק *</label>
            <input id="name" required minLength={2} maxLength={120} value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-3 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
              placeholder="למשל: מרפאת דנה" />
          </div>

          <div>
            <label htmlFor="slug" className="mb-2 block text-sm font-semibold">כתובת ייחודית באנגלית *</label>
            <div className="flex items-center gap-2">
              <input id="slug" required minLength={2} maxLength={63} pattern="[a-z0-9]+(-[a-z0-9]+)*"
                value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())}
                className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-3 text-left outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                placeholder="clinic-dana" dir="ltr" />
              <span className="text-xs text-slate-500">/biz/</span>
            </div>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label htmlFor="phone" className="mb-2 block text-sm font-semibold">טלפון עסק</label>
              <input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-3 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                placeholder="050-1234567" dir="ltr" />
            </div>
            <div>
              <label htmlFor="whatsapp" className="mb-2 block text-sm font-semibold">WhatsApp עסק</label>
              <input id="whatsapp" type="tel" value={whatsappNumber} onChange={(e) => setWhatsappNumber(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-3 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                placeholder="050-1234567" dir="ltr" />
            </div>
          </div>

          <div>
            <label htmlFor="email" className="mb-2 block text-sm font-semibold">דוא״ל העסק</label>
            <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-3 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
              placeholder="hello@example.co.il" dir="ltr" />
          </div>

          {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}

          <button type="submit" disabled={loading}
            className="w-full rounded-xl bg-blue-700 px-4 py-3 font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60">
            {loading ? 'יוצר מסד ומקים את העסק…' : 'יצירת העסק והקישורים'}
          </button>
        </form>

        {created && (
          <section aria-live="polite" className="mt-6 space-y-4 rounded-2xl border border-emerald-200 bg-white p-5 sm:p-7">
            <h2 className="text-xl font-bold text-emerald-800">העסק נוצר בהצלחה</h2>
            <p className="text-sm text-slate-600">מסד ייעודי: <code dir="ltr">{created.database}</code></p>
            <div>
              <p className="mb-1 text-sm font-semibold">אתר ציבורי</p>
              <a className="break-all text-blue-700 underline" href={created.public_url} target="_blank" rel="noreferrer">{created.public_url}</a>
            </div>
            <div>
              <p className="mb-1 text-sm font-semibold">קישור ניהול למוכר — יש לשמור ולמסור לבעל העסק</p>
              <a className="break-all text-blue-700 underline" href={created.management_url} target="_blank" rel="noreferrer">{created.management_url}</a>
              <p className="mt-2 text-xs leading-5 text-amber-800">הקישור מכיל הרשאת גישה פרטית. העבר אותו לבעל העסק בערוץ מאובטח ואל תפרסם אותו.</p>
            </div>
          </section>
        )}

        <p className="mt-6 text-center text-xs text-slate-500">הגישה ל-API מוגנת באמצעות מפתח Super Admin. אין לשתף את המפתח.</p>
      </div>
    </main>
  );
}
