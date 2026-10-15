'use client';

import { useState } from 'react';
import { mcall } from '@/lib/manageApi';
import type { ManageBusiness } from '@/lib/types';

const DOCS = [
  { key: 'accessibility_statement', title: 'הצהרת נגישות', hint: 'רמת ההתאמה, מגבלות ידועות ודרך יצירת קשר בנושא נגישות.' },
  { key: 'terms_of_use', title: 'תנאי שימוש / תקנון', hint: 'כללים רלוונטיים לשימוש באתר ולהתקשרות עם העסק.' },
  { key: 'privacy_policy', title: 'מדיניות פרטיות', hint: 'אילו פרטים נאספים, לאיזו מטרה, כיצד משתמשים בהם ולמי ניתן לפנות.' },
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
      onSaved({ ...latest, ...saved, config: { ...latest.config, ...(saved as any).config, legal } });
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
          כאן מנהלים את שלושת המסמכים של העסק במקום אחד. כל מסמך נערך בנפרד, ורק טקסט שמילאתם יוצג באתר הלקוחות.
          מומלץ לקבל ייעוץ מתאים לפני פרסום נוסח משפטי; המערכת אינה מספקת ייעוץ משפטי.
        </p>
      </div>
      {DOCS.map(({ key, title, hint }) => (
        <label key={key} className="block rounded-2xl border border-ink/10 bg-white p-4 sm:p-5">
          <span className="block font-bold">{title}</span>
          <span className="mt-1 block text-sm leading-5 text-ink/65">{hint}</span>
          <textarea
            value={values[key]}
            onChange={(e) => setValues((prev) => ({ ...prev, [key]: e.target.value }))}
            maxLength={20000}
            rows={8}
            placeholder="הזינו כאן את נוסח המסמך. אם משאירים ריק, המסמך לא יוצג באתר."
            className="mt-3 w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm leading-6 text-gray-900"
          />
          <span className="mt-1 block text-end text-xs text-gray-500">{values[key].length}/20,000 תווים</span>
        </label>
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
