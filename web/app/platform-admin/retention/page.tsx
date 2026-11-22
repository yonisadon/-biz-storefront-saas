'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

type PlanCode = 'standard' | 'plus';
type RecordType = 'lead' | 'appointment' | 'waitlist';
type Policy = {
  plan_code: PlanCode;
  record_type: RecordType;
  record_status: string;
  delete_enabled: boolean;
  retention_days: number | null;
};
const groups: { type: RecordType; title: string; rows: { status: string; label: string; description: string }[] }[] = [
  { type: 'lead', title: 'פניות CRM', rows: [
    { status: 'open', label: 'פניות פתוחות / חדשות', description: 'פניות שעדיין לא סומנו כסגורות, מבוטלות או הושלמו' },
    { status: 'closed', label: 'פניות סגורות / מבוטלות / הושלמו', description: 'תקופת השמירה מתחילה מרגע סגירת הפנייה' },
  ] },
  { type: 'appointment', title: 'פגישות ביומן', rows: [
    { status: 'reserved', label: 'פגישות שהסתיימו', description: 'תקופת השמירה מתחילה בסיום מועד הפגישה' },
    { status: 'cancelled', label: 'פגישות שבוטלו', description: 'תקופת השמירה מתחילה ברגע הביטול' },
  ] },
  { type: 'waitlist', title: 'בקשות המתנה', rows: [
    { status: 'waiting', label: 'בקשות שפג מועד ההמתנה שלהן', description: 'תקופת השמירה מתחילה לאחר התאריך והשעה המבוקשים' },
    { status: 'rejected', label: 'בקשות שנדחו', description: 'תקופת השמירה מתחילה בעדכון הסטטוס' },
    { status: 'closed', label: 'בקשות שנסגרו / שובצו', description: 'בקשה ששובצה נשמרת ביחס למועד הפגישה המקושרת' },
    { status: 'scheduled_without_booking', label: 'בקשות שטופלו ללא קביעת תור', description: 'תקופת השמירה מתחילה בעדכון הסטטוס' },
  ] },
];

export default function RetentionAdminPage() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;
    fetch('/api/admin/retention-policies', { cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.message ?? 'לא ניתן לטעון את מדיניות השמירה.');
        if (active) setPolicies((data?.policies ?? []) as Policy[]);
      })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : 'טעינת ההגדרות נכשלה.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const complete = useMemo(() => policies.length === 16, [policies]);
  function update(plan: PlanCode, type: RecordType, status: string, patch: Partial<Policy>) {
    setPolicies((current) => current.map((item) =>
      item.plan_code === plan && item.record_type === type && item.record_status === status
        ? { ...item, ...patch } : item,
    ));
  }

  async function save() {
    setSaving(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/admin/retention-policies', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ policies }),
        cache: 'no-store',
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.message ?? data?.error ?? 'שמירת מדיניות השמירה נכשלה.');
      setPolicies((data?.policies ?? policies) as Policy[]);
      setMessage('ההגדרות נשמרו. הן יחולו בהרצת הניקוי המתוזמנת הבאה; שמירת ההגדרות אינה מוחקת נתונים מיד.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שמירת ההגדרות נכשלה.');
    } finally { setSaving(false); }
  }

  return (
    <main dir="rtl" className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 sm:px-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link href="/platform-admin" className="text-sm font-semibold text-blue-700 underline">חזרה ללוח הבקרה</Link>
            <h1 className="mt-2 text-3xl font-bold">מדיניות שמירת נתונים</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              שליטה מרכזית בזמני השמירה והמחיקה האוטומטית לכל סוג רשומה ולכל מסלול. אפשר לכבות מחיקה לחלוטין או לבחור תקופה של יום עד 10 שנים.
            </p>
          </div>
          <button type="button" onClick={save} disabled={loading || saving || !complete}
            className="rounded-xl bg-blue-700 px-5 py-3 font-semibold text-white disabled:opacity-50">
            {saving ? 'שומר…' : 'שמירת הגדרות'}
          </button>
        </div>

        {loading && <p role="status" className="rounded-xl bg-white p-4 text-sm text-slate-600">טוען הגדרות…</p>}
        {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
        {message && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{message}</p>}

        {(['standard', 'plus'] as PlanCode[]).map((plan) => (
          <section key={plan} className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
            <div>
              <h2 className="text-xl font-bold">{plan === 'standard' ? 'מנוי רגיל (Basic)' : 'מנוי Plus'}</h2>
              <p className="mt-1 text-sm text-slate-600">
                {plan === 'standard'
                  ? 'ברירת המחדל: פניות פתוחות 60 יום, פניות סגורות 30 יום; פגישות ובקשות המתנה יום אחד.'
                  : 'ברירת המחדל: אין מחיקה אוטומטית. ניתן להפעיל מחיקה ולבחור תקופה לכל סוג רשומה בנפרד.'}
              </p>
            </div>
            {groups.map((group) => (
              <div key={group.type} className="space-y-3">
                <h3 className="border-b border-slate-100 pb-2 font-semibold">{group.title}</h3>
                {group.rows.map((row) => {
                  const policy = policies.find((item) =>
                    item.plan_code === plan && item.record_type === group.type && item.record_status === row.status,
                  );
                  return (
                    <div key={row.status} className="grid gap-3 rounded-xl bg-slate-50 p-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
                      <div>
                        <p className="font-medium">{row.label}</p>
                        <p className="mt-1 text-xs leading-5 text-slate-500">{row.description}</p>
                      </div>
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={Boolean(policy?.delete_enabled)}
                          onChange={(event) => update(plan, group.type, row.status, {
                            delete_enabled: event.target.checked,
                            retention_days: event.target.checked ? (policy?.retention_days ?? 1) : null,
                          })} />
                        מחיקה אוטומטית
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <span>אחרי</span>
                        <input type="number" min={1} max={3650} step={1}
                          disabled={!policy?.delete_enabled}
                          value={policy?.retention_days ?? ''}
                          onChange={(event) => update(plan, group.type, row.status, {
                            retention_days: event.target.value === '' ? null : Number(event.target.value),
                          })}
                          className="w-24 rounded-lg border border-slate-300 bg-white px-2 py-2 text-center disabled:bg-slate-100 disabled:text-slate-400" />
                        <span>ימים</span>
                      </label>
                    </div>
                  );
                })}
              </div>
            ))}
          </section>
        ))}

        <p className="text-xs leading-5 text-slate-500">
          שינוי מדיניות אינו מוחק נתונים בעת השמירה. המחיקה מתבצעת רק במשימת הניקוי המתוזמנת. מחיקה ידנית של פניות על ידי בעל העסק נשארת זמינה. שינוי המדיניות חל לפי המסלול הרשום למנוי העסק.
        </p>
      </div>
    </main>
  );
}
