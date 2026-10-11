export const ils = (agorot: number) => {
  const whole = Number.isInteger(agorot / 100);
  return new Intl.NumberFormat('he-IL', {
    style: 'currency', currency: 'ILS',
    minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2,
  }).format(agorot / 100);
};
export const toLocalPhone = (e164: string | null) => (e164 ? '0' + e164.slice(4) : '');
export const waLink = (e164: string) => `https://wa.me/${e164.slice(1)}`;
export function normalizeILPhone(input: string): string | null {
  let s = input.replace(/[\s\-().\u200e\u200f\u202a-\u202e]/g, '');
  if (s.startsWith('+')) s = s.slice(1);
  if (s.startsWith('00972')) s = s.slice(2);
  if (s.startsWith('0')) s = '972' + s.slice(1);
  return /^972(5\d{8}|[23489]\d{7}|7\d{8})$/.test(s) ? '+' + s : null;
}
export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', dateStyle: 'short', timeStyle: 'short' });