'use client';

import { useState } from 'react';
import { mcall } from '@/lib/manageApi';
import { LEGAL_DEFAULTS } from '@/lib/legalDefaults';
import type { ManageBusiness } from '@/lib/types';

const DOCS = [
  {
    key: 'accessibility_statement',
    title: 'הצהרת נגישות',
    hint: 'תארו את התאמות הנגישות באתר העסק, מגבלות ידועות ודרך יצירת קשר בנושא נגישות.',
    placeholder: 'לדוגמה: התאמות שבוצעו באתר, מגבלות שידועות לכם, ואיך ניתן לפנות אליכם בנושא נגישות.',
  },
  {
    key: 'terms_of_use',
    title: 'תנאי שימוש / תקנון',
    hint: 'הוסיפו את התנאים המסחריים של העסק, בהתאם לאופן הפעילות שלו.',
    placeholder: 'לדוגמה: אופן הזמנה, תשלום, אספקה או קבלת השירות, ביטולים, החזרות, אחריות ותנאים מיוחדים.',
  },
  {
    key: 'privacy_policy',
    title: 'מדיניות פרטיות',
    hint: 'פרטו מידע נוסף שהעסק אוסף או שומר, מטרות השימוש בו וגורמים שעשויים לקבל אותו.',
    placeholder: 'לדוגמה: מידע שנאסף מחוץ לטופס באתר, שימושים נוספים במידע, העברה לספקים או לגורמים אחרים, תקופות שמירה ודרך לפנות לעסק בנושא פרטיות.',
  },
] as const;

type DocKey = (typeof DOCS)[number]['key'];
type LegalValues = Record<DocKey, string>;

function readLegal(biz: ManageBusiness): LegalValues {
  const legal = biz.config?.legal ?? {};
  return {
    accessibility_statement: String(legal.accessibility_statement?.custom_text ?? ''),
    terms_of_use: String(legal.terms_of_use?.custom_text ?? ''),
    privacy_policy: String(legal.privacy_policy?.custom_text ?? ''),
  };
}

export default function LegalPanel({ token, biz, onSaved }: {
  token: string; biz: ManageBusiness; onSaved: (b: ManageBusiness) => void;
}) {
  const [values, setValues] = useState<LegalValues>(() => readLegal(biz));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save() {
    setSaving(true); setMessage(null);
    try {
      const latest = await mcall<ManageBusiness>(token, 'business');
      const legal = Object.fromEntries(DOCS.map(({ key }) => [
        key, { custom_text: values[key].trim() || '' },
      ]));
      const saved = await mcall<Partial<ManageBusiness>>(token, 'business', {
        method: 'PATCH',
        body: JSON.stringify({ config: { legal } }),
      });
      onSaved({ ...latest, ...saved, config: { ...latest.config, ...(saved.config ?? {}), legal } });
      setMessage('מסמכי האתר נשמרו.');
    } catch {
      setMessage('שמירת המסמכים נכשלה. בדקו את החיבור ונסו שוב.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-label="מסמכי האתר" className="space-y-4">
      <div className="rounded-2xl border border-ink/10 bg-white p-4 sm:p-5">
        <h2 className="text-lg font-bold">מסמכי האתר</h2>
        <p className="mt-2 text-sm leading-6 text-ink/70">
          שלושת המסמכים מורכבים משני חלקים: נוסח קבוע של Biz Storefront, שמופיע אוטומטית ואינו ניתן לעריכה,
          והשלמות שהעסק מוסיף בהתאם לפעילות שלו. רק ההשלמות נשמרות בהגדרות העסק.
          מומלץ לקבל ייעוץ מתאים לפני פרסום נוסח משפטי; המערכת אינה מספקת ייעוץ משפטי.
        </p>
        <p className="mt-2 text-sm leading-6 text-ink/70">
          אם כבר הזנתם בעבר מסמך מלא, עברו על הטקסט שהזנתם והתאימו אותו כך שיכלול רק את המידע הנוסף של העסק, כדי למנוע כפילויות.
        </p>
      </div>
      {DOCS.map(({ key, title, hint, placeholder }) => (
        <section key={key} aria-labelledby={`legal-${key}`} className="rounded-2xl border border-ink/10 bg-white p-4 sm:p-5">
          <h3 id={`legal-${key}`} className="font-bold">{title}</h3>
          <p className="mt-1 text-sm leading-5 text-ink/65">{hint}</p>

          <details className="mt-3 rounded-xl border border-ink/10 bg-slate-50 p-3">
            <summary className="cursor-pointer text-sm font-semibold">
              החלק הקבוע של Biz Storefront – לקריאה בלבד
            </summary>
            <p className="mt-3 whitespace-pre-line break-words text-sm leading-6 text-ink/75">
              {LEGAL_DEFAULTS[key]}
            </p>
          </details>

          <label htmlFor={`legal-input-${key}`} className="mt-4 block text-sm font-semibold">
            השלמות מטעם העסק
          </label>
          <textarea
            id={`legal-input-${key}`}
            value={values[key]}
            onChange={(e) => setValues((prev) => ({ ...prev, [key]: e.target.value }))}
            maxLength={20000}
            rows={6}
            placeholder={placeholder}
            className="mt-2 w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm leading-6 text-gray-900"
          />
          <span className="mt-1 block text-end text-xs text-gray-500">{values[key].length}/20,000 תווים</span>
        </section>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={save} disabled={saving}
          className="min-h-11 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-fg disabled:opacity-50">
          {saving ? 'שומר…' : 'שמירת מסמכי האתר'}
        </button>
        {message && <p role="status" className="text-sm text-ink/75">{message}</p>}
      </div>
    </section>
  );
}
