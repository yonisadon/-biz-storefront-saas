export type OpeningRange = { open: string; close: string };
export type OpeningDays = Record<string, unknown> | null | undefined;

export function hasConfiguredOpeningHours(days: OpeningDays): boolean {
  if (!days || typeof days !== 'object') return false;
  return Object.values(days).some((ranges) => Array.isArray(ranges) && ranges.length > 0);
}

function toMinutes(value: string): number {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return Number.NaN;
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function localNow(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

export function validateAppointmentSelection(args: {
  needsAppointment: boolean;
  appointmentAt?: string;
  durationMinutes: number;
  openingHoursDays: OpeningDays;
  timezone: string;
  now?: Date;
}): string | null {
  const { needsAppointment, appointmentAt, durationMinutes, openingHoursDays, timezone } = args;
  if (!needsAppointment) return appointmentAt ? 'appointment_not_applicable' : null;

  const hasHours = hasConfiguredOpeningHours(openingHoursDays);
  if (!appointmentAt) return hasHours ? 'appointment_required' : null;
  if (!hasHours) return 'invalid_appointment_time';

  const [datePart, timePart] = appointmentAt.split('T');
  const parsedDate = new Date(`${datePart}T12:00:00Z`);
  const validDate = Number.isFinite(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === datePart;
  const requestedMinutes = toMinutes(timePart ?? '');
  if (!validDate || !Number.isFinite(requestedMinutes)) return 'invalid_appointment_time';

  const dateForWeekday = new Date(`${datePart}T12:00:00`);
  const dayKey = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][dateForWeekday.getDay()];
  const ranges = openingHoursDays && typeof openingHoursDays === 'object'
    ? openingHoursDays[dayKey]
    : undefined;
  const validSlot = durationMinutes > 0 && durationMinutes <= 480
    && Array.isArray(ranges)
    && ranges.some((range) => {
      if (!range || typeof range !== 'object') return false;
      const open = toMinutes(String((range as OpeningRange).open ?? ''));
      const close = toMinutes(String((range as OpeningRange).close ?? ''));
      return Number.isFinite(open) && Number.isFinite(close)
        && requestedMinutes >= open
        && requestedMinutes + durationMinutes <= close
        && (requestedMinutes - open) % durationMinutes === 0;
    });

  let nowLocal: string;
  try {
    nowLocal = localNow(args.now ?? new Date(), timezone);
  } catch {
    return 'invalid_appointment_time';
  }
  if (!validSlot || appointmentAt <= nowLocal) return 'invalid_appointment_time';
  return null;
}
