// ---- Israeli phone normalization -> E.164 (+972...) or null ----
export function normalizeILPhone(input: string): string | null {
  let s = input.replace(/[\s\-().\u200e\u200f\u202a-\u202e]/g, '');
  if (s.startsWith('+')) s = s.slice(1);
  if (s.startsWith('00972')) s = s.slice(2);
  if (s.startsWith('0')) s = '972' + s.slice(1);
  return /^972(5\d{8}|[23489]\d{7}|7\d{8})$/.test(s) ? '+' + s : null;
}

export const toLocalPhone = (e164: string) => '0' + e164.slice(4);

// ---- money (agorot -> display) ----
export const ils = (agorot: number) =>
  '₪' + (agorot / 100).toLocaleString('he-IL', { maximumFractionDigits: 2 });

// ---- {placeholder} templates ----
export const renderTemplate = (tpl: string, vars: Record<string, string>) =>
  tpl.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');

// ---- open/closed now, in the business timezone (same-day ranges only) ----
export function isOpenNow(hours: any, tz: string, now = new Date()): boolean | null {
  const days = hours?.days;
  if (!days) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const day = days[get('weekday').toLowerCase().slice(0, 3)];
  if (!day || day === 'closed') return false;
  const hhmm = `${get('hour')}:${get('minute')}`;
  return day.some((r: { open: string; close: string }) => r.open <= hhmm && hhmm < r.close);
}

export const mediaUrl = (base: string, storageKey: string) => `${base.replace(/\/+$/, '')}/media/${storageKey}`;
