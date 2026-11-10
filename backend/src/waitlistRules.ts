export function isValidCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day;
}

export function isValidWaitlistTimeRange(from?: string, to?: string): boolean {
  if (from === undefined && to === undefined) return true;
  if (from === undefined || to === undefined) return false;
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(from) &&
    /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(to) &&
    to > from;
}

export function hasUniqueServiceIds(ids: string[]): boolean {
  return new Set(ids).size === ids.length;
}
