'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { mcall } from '@/lib/manageApi';
import type { ManageBusiness, MProduct, MProductsResponse } from '@/lib/types';

type Appointment = {
  id: string; lead_id: string | null; service_id: string | null; service_name: string;
  customer_phone: string; start_at: string; end_at: string; source: 'website' | 'manual';
  status: 'reserved' | 'cancelled'; created_at?: string;
};
type TimeBlock = { id: string; start_at: string; end_at: string; reason: string | null; conflicting_appointments?: number };
type CalendarResponse = { date: string; timezone: string; appointments: Appointment[]; blocks: TimeBlock[] };
type OpeningRange = { open: string; close: string };

function todayLocal() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
function localLabel(value: string) { return value.slice(11, 16); }
function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string) {
  return aStart < bEnd && bStart < aEnd;
}
function slotsFor(date: string, duration: number, ranges: OpeningRange[], appointments: Appointment[], blocks: TimeBlock[]) {
  const result: string[] = [];
  const mins = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  for (const range of ranges) {
    const open = mins(range.open), close = mins(range.close);
    if (!Number.isFinite(open) || !Number.isFinite(close) || duration <= 0) continue;
    for (let m = open; m + duration <= close; m += duration) {
      const start = `${date}T${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      const endM = m + duration;
      const end = `${date}T${String(Math.floor(endM / 60)).padStart(2, '0')}:${String(endM % 60).padStart(2, '0')}`;
      if (appointments.some((a) => a.status === 'reserved' && overlaps(start, end, a.start_at, a.end_at))) continue;
      if (blocks.some((b) => overlaps(start, end, b.start_at, b.end_at))) continue;
      result.push(start);
    }
  }
  return result;
}

export default function CalendarPanel({ token, biz }: { token: string; biz: ManageBusiness }) {
  const [date, setDate] = useState(todayLocal);
  const [calendar, setCalendar] = useState<CalendarResponse | null>(null);
  const [products, setProducts] = useState<MProduct[]>([]);
  const [serviceId, setServiceId] = useState('');
  const [phone, setPhone] = useState('');
  const [startTime, setStartTime] = useState('');
  const [blockStart, setBlockStart] = useState('12:00');
  const [blockEnd, setBlockEnd] = useState('13:00');
  const [blockReason, setBlockReason] = useState('');
  const [allDayBlock, setAllDayBlock] = useState(false);
  const [editingTimes, setEditingTimes] = useState<Record<string, string>>({});
  const [editingServices, setEditingServices] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const [cal, list] = await Promise.all([
        mcall<CalendarResponse>(token, `appointments?date=${date}`),
        mcall<MProductsResponse>(token, 'products?limit=100&offset=0&status=active'),
      ]);
      setCalendar(cal);
      const services = list.items.filter((p) => p.kind === 'service' && p.is_active);
      setProducts(services);
      setServiceId((current) => services.some((p) => p.id === current) ? current : services[0]?.id ?? '');
    } catch {
      setError('לא הצלחנו לטעון את היומן. ודאו שמסד העסק עודכן במיגרציה ושגרסת השרת תומכת ביומן.');
    } finally { setBusy(false); }
  }, [token, date]);

  useEffect(() => { void load(); }, [load]);

  const service = products.find((p) => p.id === serviceId);
  const ranges = useMemo(() => {
    const days = biz.config?.opening_hours?.days;
    if (!days || typeof days !== 'object') return [];
    const weekday = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date(`${date}T12:00:00Z`).getUTCDay()];
    const value = (days as Record<string, unknown>)[weekday];
    return Array.isArray(value) ? value.filter((r): r is OpeningRange => !!r && typeof r === 'object' && typeof (r as OpeningRange).open === 'string' && typeof (r as OpeningRange).close === 'string') : [];
  }, [biz.config, date]);
  const freeSlots = useMemo(() => service && calendar
    ? slotsFor(date, service.appointment_duration_minutes || 30, ranges, calendar.appointments, calendar.blocks)
    : [], [service, calendar, date, ranges]);

  async function createAppointment() {
    if (!serviceId || !phone.trim() || !startTime) return setError('יש לבחור שירות, להזין טלפון ולבחור שעה פנויה.');
    setBusy(true); setError(null); setMessage(null);
    try {
      await mcall(token, 'appointments', {
        method: 'POST',
        body: JSON.stringify({ service_id: serviceId, customer_phone: phone, start_at: `${date}T${startTime}` }),
      });
      setPhone(''); setStartTime('');
      setMessage('התור הידני נשמר ביומן.');
      await load();
    } catch (err) {
      setError(err instanceof Error && err.message.includes('409')
        ? 'השעה נתפסה בינתיים. בחרו שעה אחרת.'
        : 'שמירת התור נכשלה. בדקו את מספר הטלפון, שעות הפעילות וזמינות השעה.');
    } finally { setBusy(false); }
  }

  async function changeStatus(item: Appointment, status: 'reserved' | 'cancelled') {
    setBusy(true); setError(null); setMessage(null);
    try {
      await mcall(token, `appointments/${item.id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      setMessage(status === 'cancelled' ? 'התור בוטל והשעה שוחררה.' : 'התור חזר ליומן.');
      await load();
    } catch { setError('עדכון התור נכשל. אם המועד החדש אינו פנוי, התור המקורי נשאר ללא שינוי.'); }
    finally { setBusy(false); }
  }

  async function saveAppointment(item: Appointment) {
    const start_at = editingTimes[item.id] || undefined;
    const service_id = editingServices[item.id] || item.service_id || undefined;
    if (!start_at && !editingServices[item.id]) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      await mcall(token, `appointments/${item.id}`, { method: 'PATCH', body: JSON.stringify({ ...(start_at ? { start_at } : {}), ...(service_id ? { service_id } : {}) }) });
      setMessage('פרטי התור עודכנו.');
      setEditingTimes((v) => { const n = { ...v }; delete n[item.id]; return n; });
      setEditingServices((v) => { const n = { ...v }; delete n[item.id]; return n; });
      await load();
    } catch { setError('לא ניתן לשמור את השינוי. ייתכן שהמועד תפוס או מחוץ לשעות הפעילות; התור המקורי לא שונה.'); }
    finally { setBusy(false); }
  }

  async function deleteAppointment(item: Appointment) {
    if (!confirm(`למחוק את התור של ${item.customer_phone}?`)) return;
    setBusy(true); setError(null);
    try { await mcall(token, `appointments/${item.id}`, { method: 'DELETE' }); setMessage('התור נמחק.'); await load(); }
    catch { setError('מחיקת התור נכשלה.'); }
    finally { setBusy(false); }
  }

  async function createBlock() {
    if (!allDayBlock && (!blockStart || !blockEnd || blockEnd <= blockStart)) return setError('שעת סיום החסימה חייבת להיות אחרי שעת ההתחלה.');
    setBusy(true); setError(null); setMessage(null);
    try {
      const nextDateValue = new Date(`${date}T12:00:00Z`);
      nextDateValue.setUTCDate(nextDateValue.getUTCDate() + 1);
      const nextDate = `${nextDateValue.getUTCFullYear()}-${String(nextDateValue.getUTCMonth() + 1).padStart(2, '0')}-${String(nextDateValue.getUTCDate()).padStart(2, '0')}`;
      const result = await mcall<TimeBlock>(token, 'appointment-blocks', {
        method: 'POST',
        body: JSON.stringify({
          start_at: allDayBlock ? `${date}T00:00` : `${date}T${blockStart}`,
          end_at: allDayBlock ? `${nextDate}T00:00` : `${date}T${blockEnd}`,
          reason: blockReason,
        }),
      });
      setMessage(result.conflicting_appointments
        ? `החסימה נשמרה, אבל קיימים ${result.conflicting_appointments} תורים משוריינים בטווח. הם לא בוטלו; יש לטפל בהם ידנית.`
        : 'החסימה נשמרה ותמנע קביעות חדשות בטווח.');
      setBlockReason(''); setAllDayBlock(false);
      await load();
    } catch { setError('שמירת החסימה נכשלה.'); }
    finally { setBusy(false); }
  }

  async function deleteBlock(block: TimeBlock) {
    setBusy(true); setError(null);
    try { await mcall(token, `appointment-blocks/${block.id}`, { method: 'DELETE' }); setMessage('החסימה הוסרה.'); await load(); }
    catch { setError('הסרת החסימה נכשלה.'); }
    finally { setBusy(false); }
  }

  const field = 'min-h-10 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm';
  return <section dir="rtl" aria-label="יומן תורים" className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-lg font-bold">יומן תורים</h2><p className="mt-1 text-sm text-gray-600">תורים משוריינים, שעות פנויות וחסימות חריגות.</p></div>
      <div className="flex items-center gap-2"><label className="text-sm">תאריך <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={field}/></label><button type="button" onClick={() => void load()} disabled={busy} className="rounded-full border border-gray-300 bg-white px-4 py-2 text-sm">רענון</button></div>
    </div>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {message && <p role="status" className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">{message}</p>}
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-2xl border border-gray-200 bg-white p-4">
        <h3 className="font-bold">קביעת תור ידני</h3>
        <p className="mt-1 text-xs text-gray-500">התור נשמר ביומן בלבד, ללא יצירת פנייה נפרדת.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">שירות<select className={`${field} mt-1 w-full`} value={serviceId} onChange={(e) => { setServiceId(e.target.value); setStartTime(''); }}><option value="">בחירת שירות</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.appointment_duration_minutes} דק׳</option>)}</select></label>
          <label className="text-sm">טלפון לקוח<input className={`${field} mt-1 w-full`} dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="05X-XXXXXXX"/></label>
        </div>
        <div className="mt-3"><p className="text-sm font-medium">שעות פנויות</p>
          {!service && <p className="mt-2 text-sm text-gray-500">בחרו שירות כדי לראות שעות פנויות.</p>}
          {service && !freeSlots.length && <p className="mt-2 text-sm text-gray-500">אין שעות פנויות לפי שעות הפעילות, התורים והחסימות.</p>}
          <div className="mt-2 flex flex-wrap gap-2">{freeSlots.map((slot) => <button type="button" key={slot} onClick={() => setStartTime(localLabel(slot))} className={`rounded-full px-3 py-2 text-sm ring-1 ${startTime === localLabel(slot) ? 'bg-gray-900 text-white ring-gray-900' : 'bg-white ring-gray-300'}`}>{localLabel(slot)}</button>)}</div>
        </div>
        <button type="button" onClick={() => void createAppointment()} disabled={busy || !service || !phone.trim() || !startTime} className="mt-4 min-h-11 w-full rounded-full bg-gray-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">שמירת תור ביומן</button>
      </div>
      <div className="rounded-2xl border border-gray-200 bg-white p-4">
        <h3 className="font-bold">חסימת זמן</h3><p className="mt-1 text-xs text-gray-500">חסימה מונעת תורים חדשים. תורים קיימים נשארים משוריינים ומוצגת אזהרה.</p>
        <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={allDayBlock} onChange={(e) => setAllDayBlock(e.target.checked)}/> חסימת יום מלא</label>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="text-sm">משעה<input type="time" disabled={allDayBlock} className={`${field} mt-1 w-full disabled:opacity-50`} value={blockStart} onChange={(e) => setBlockStart(e.target.value)}/></label>
          <label className="text-sm">עד שעה<input type="time" disabled={allDayBlock} className={`${field} mt-1 w-full disabled:opacity-50`} value={blockEnd} onChange={(e) => setBlockEnd(e.target.value)}/></label>
        </div>
        <label className="mt-3 block text-sm">סיבה (לא חובה)<input className={`${field} mt-1 w-full`} value={blockReason} onChange={(e) => setBlockReason(e.target.value)} maxLength={300} placeholder="למשל: הפסקה"/></label>
        <button type="button" onClick={() => void createBlock()} disabled={busy} className="mt-3 min-h-11 w-full rounded-full border border-gray-300 bg-white px-4 py-2 text-sm font-semibold">שמירת חסימה</button>
      </div>
    </div>
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <h3 className="font-bold">תורים לתאריך הנבחר</h3>
      {busy && !calendar && <p className="mt-3 text-sm text-gray-500">טוען…</p>}
      {!calendar?.appointments.length && <p className="mt-3 text-sm text-gray-500">אין תורים משוריינים בתאריך זה.</p>}
      <div className="mt-3 space-y-3">{calendar?.appointments.map((item) => <div key={item.id} className="rounded-xl border border-gray-200 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-semibold">{localLabel(item.start_at)}–{localLabel(item.end_at)} · {item.service_name}</p><p className="mt-1 text-sm text-gray-600" dir="ltr">{item.customer_phone} · {item.source === 'manual' ? 'תור ידני' : 'הגיע מהאתר'}</p><p className="mt-1 text-xs text-gray-500">{item.status === 'reserved' ? 'משוריין' : 'בוטל'}</p></div>
          <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => void changeStatus(item, item.status === 'reserved' ? 'cancelled' : 'reserved')} className="rounded-full border border-gray-300 px-3 py-1.5 text-xs">{item.status === 'reserved' ? 'ביטול ושחרור שעה' : 'החזרה ליומן'}</button><button type="button" disabled={busy} onClick={() => void deleteAppointment(item)} className="rounded-full border border-red-200 px-3 py-1.5 text-xs text-red-700">מחיקה</button></div>
        </div>
        {item.status === 'reserved' && <div className="mt-3 flex flex-wrap gap-2">
          <label className="text-xs text-gray-600">שירות<select aria-label="שירות חדש" className={field} value={editingServices[item.id] ?? item.service_id ?? ''} onChange={(e) => setEditingServices((v) => ({ ...v, [item.id]: e.target.value }))}><option value="">שירות לא זמין</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.appointment_duration_minutes} דק׳</option>)}</select></label>
          <label className="text-xs text-gray-600">מועד חדש<input type="datetime-local" aria-label="מועד חדש" className={field} value={editingTimes[item.id] ?? ''} onChange={(e) => setEditingTimes((v) => ({ ...v, [item.id]: e.target.value }))}/></label>
          <button type="button" disabled={busy || (!editingTimes[item.id] && !editingServices[item.id])} onClick={() => void saveAppointment(item)} className="self-end rounded-full bg-gray-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">שמירת שינויים</button>
        </div>}
      </div>)}</div>
    </div>
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <h3 className="font-bold">חסימות לתאריך הנבחר</h3>
      {!calendar?.blocks.length && <p className="mt-2 text-sm text-gray-500">אין חסימות.</p>}
      <div className="mt-2 space-y-2">{calendar?.blocks.map((block) => <div key={block.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-gray-50 p-3 text-sm"><span>{localLabel(block.start_at)}–{localLabel(block.end_at)}{block.reason ? ` · ${block.reason}` : ''}</span><button type="button" disabled={busy} onClick={() => void deleteBlock(block)} className="text-red-700 underline">הסרת חסימה</button></div>)}</div>
    </div>
  </section>;
}
