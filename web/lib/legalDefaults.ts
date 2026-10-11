export const LEGAL_DOCS = ['terms_of_use', 'privacy_policy', 'accessibility_statement'] as const;
export type LegalDoc = (typeof LEGAL_DOCS)[number];
export const isLegalDoc = (v: string): v is LegalDoc => (LEGAL_DOCS as readonly string[]).includes(v);
export const LEGAL_TITLES: Record<LegalDoc, string> = {
  terms_of_use: 'תנאי שימוש',
  privacy_policy: 'מדיניות פרטיות',
  accessibility_statement: 'הצהרת נגישות',
};
export const LEGAL_DEFAULTS: Record<LegalDoc, string> = {
  terms_of_use: 'כאן יופיע נוסח תנאי השימוש של הפלטפורמה.\n\n[יש להחליף בנוסח משפטי מאושר]',
  privacy_policy: 'כאן תופיע מדיניות הפרטיות של הפלטפורמה: אילו פרטים נאספים בטופס הפנייה, למי הם נמסרים ולכמה זמן הם נשמרים.\n\n[יש להחליף בנוסח משפטי מאושר]',
  accessibility_statement: 'כאן תופיע הצהרת הנגישות: רמת ההתאמה, מגבלות ידועות ופרטי רכז הנגישות.\n\n[יש להחליף בנוסח מאושר]',
};