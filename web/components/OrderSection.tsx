'use client';

import Image from 'next/image';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ils, normalizeILPhone } from '@/lib/format';
import type { DayHours, OrderFlow, Product, PublicCatalogPage } from '@/lib/types';

type Props = { apiBase: string; items: Product[]; quoteLabel: string; flow: OrderFlow; openingHours: Record<string, DayHours> | null; catalogTotal: number; hasMore: boolean };
type Route = 'whatsapp' | 'site';
type Done = { route: 'site'; message: string } | { route: 'whatsapp'; url: string; message: string };
type Step = 'choose' | 'site';

type ApiErrorPayload = { issues?: { message: string }[]; error?: string; route?: string; whatsapp_url?: string; success_message?: string };

function errorText(status: number, d: ApiErrorPayload | null): string {
  if (status === 429) return 'בוצעו יותר מדי ניסיונות. נסו שוב בעוד דקה.';
  if (status === 403) return 'מסלול ההזמנה הזה אינו זמין כרגע.';
  if (d?.error === 'appointment_required') return 'בחרו תאריך ושעה לשירות שסימנתם.';
  if (d?.error === 'invalid_appointment_time') return 'התאריך או השעה אינם זמינים בשעות הפעילות. בחרו שוב.';
  if (d?.error === 'contact_required') return 'כדי לשמור תור ביומן, יש להזין מספר טלפון.';
  if (d?.error === 'appointment_not_applicable') return 'לא ניתן לבחור מועד עבור הפריטים שנבחרו.';
  const msgs: string[] = (d?.issues ?? []).map((i) => i.message);
  if (msgs.includes('invalid_il_phone')) return 'מספר הטלפון אינו תקין.';
  if (msgs.includes('items_or_message_required')) return 'בחרו פריט או כתבו הודעה.';
  if (msgs.includes('contact_required')) return 'נא להזין מספר טלפון תקין.';
  if (msgs.includes('appointment_required')) return 'בחרו תאריך ושעה לשירות שסימנתם.';
  if (msgs.includes('invalid_appointment_time')) return 'התאריך או השעה אינם זמינים בשעות הפעילות. בחרו שוב.';
  if (d?.error === 'unknown_product') return 'אחד הפריטים כבר אינו זמין. רעננו את הדף ונסו שוב.';
  if (d?.error === 'slot_taken') return 'השעה נתפסה בינתיים. בחרו מועד פנוי אחר.';
  if (d?.error === 'mixed_booking_modes') return 'אי אפשר לשלב באותה הזמנה שירותים עם סוגי תיאום שונים. שלחו כל סוג תיאום בנפרד.';
  return 'לא הצלחנו לשלוח. נסו שוב.';
}

function Stepper({ q, onChange, label }: { q: number; onChange: (n: number) => void; label: string }) {
  const btn = 'h-9 w-9 rounded-full border border-ink/25 text-lg leading-none flex items-center justify-center';
  return (
    <div className="flex items-center gap-1" role="group" aria-label={label}>
      <button type="button" className={btn} aria-label="הפחתת כמות" onClick={() => onChange(q - 1)}>−</button>
      <span className="w-8 text-center font-semibold" aria-live="polite">{q}</span>
      <button type="button" className={btn} aria-label="הוספת כמות" onClick={() => onChange(q + 1)}>+</button>
    </div>
  );
}

export default function OrderSection({ apiBase, items: initialItems, quoteLabel, flow, openingHours, catalogTotal, hasMore: initiallyHasMore }: Props) {
  const dlg = useRef<HTMLDialogElement>(null);
  const [items, setItems] = useState<Product[]>(initialItems);
  const [nextOffset, setNextOffset] = useState(initialItems.length);
  const [hasMore, setHasMore] = useState(initiallyHasMore);
  const [loadingMore, setLoadingMore] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [form, setForm] = useState({ name: '', phone: '', email: '', hp: '' });
  const [appointmentDate, setAppointmentDate] = useState('');
  const [appointmentTime, setAppointmentTime] = useState('');
  const [serverAppointmentSlots, setServerAppointmentSlots] = useState<string[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [step, setStep] = useState<Step>('choose');
  const [busy, setBusy] = useState<Route | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  const canOrder = flow.whatsapp_enabled || flow.site_inquiry_enabled;
  async function loadMore() {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true); setCatalogError(null);
    try {
      const response = await fetch(`${apiBase}/catalog?limit=12&offset=${nextOffset}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('catalog_request_failed');
      const page = await response.json() as PublicCatalogPage;
      setItems((current) => { const known = new Set(current.map((item) => item.id)); return [...current, ...page.items.filter((item) => !known.has(item.id))]; });
      setNextOffset(page.offset + page.items.length); setHasMore(page.has_more);
    } catch { setCatalogError('לא הצלחנו לטעון מוצרים נוספים. נסו שוב.'); }
    finally { setLoadingMore(false); }
  }
  const byId = useMemo(() => new Map(items.map((p) => [p.id, p])), [items]);
  const lines = Object.entries(cart)
    .map(([id, q]) => ({ p: byId.get(id)!, q }))
    .filter((l) => l.p);
  const count = lines.reduce((s, l) => s + l.q, 0);
  const modeOf = (p: Product) => p.booking_mode ?? (p.requires_appointment ? 'free_datetime' : 'none');
  const appointmentLines = lines.filter(({ p }) => p.kind === 'service' && modeOf(p) !== 'none');
  const appointmentModes = [...new Set(appointmentLines.map(({ p }) => modeOf(p)))];
  const bookingMode = appointmentModes[0] ?? 'none';
  const needsAppointment = appointmentLines.length > 0;
  const needsReservedAppointment = bookingMode === 'availability';
  const appointmentDurationMinutes = appointmentLines.reduce((sum, { p, q }) => sum + p.appointment_duration_minutes * q, 0);
  const cartSignature = useMemo(() => Object.entries(cart).sort(([a], [b]) => a.localeCompare(b)).map(([id, quantity]) => `${id}:${quantity}`).join(','), [cart]);
  const hasAppointmentHours = useMemo(
    () => Object.values(openingHours ?? {}).some((ranges) => Array.isArray(ranges) && ranges.length > 0),
    [openingHours],
  );
  const appointmentTimeRequired = needsAppointment && (needsReservedAppointment || hasAppointmentHours);
  const localAppointmentSlots = useMemo(() => {
    if (!appointmentDate || !hasAppointmentHours || !openingHours || appointmentDurationMinutes <= 0 || appointmentDurationMinutes > 480 || needsReservedAppointment) return [];
    const date = new Date(`${appointmentDate}T12:00:00Z`);
    const key = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][date.getUTCDay()];
    const ranges = openingHours[key];
    if (!Array.isArray(ranges)) return [];
    const slots: string[] = [];
    for (const range of ranges) {
      const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
      for (let minute = toMinutes(range.open); minute + appointmentDurationMinutes <= toMinutes(range.close); minute += appointmentDurationMinutes) {
        slots.push(`${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`);
      }
    }
    return slots;
  }, [appointmentDate, openingHours, appointmentDurationMinutes, hasAppointmentHours, needsReservedAppointment]);
  useEffect(() => {
    if (!needsReservedAppointment || !appointmentDate || !cartSignature) {
      setServerAppointmentSlots([]);
      setSlotsLoading(false);
      return;
    }
    const params = new URLSearchParams({ date: appointmentDate, items: cartSignature });
    let cancelled = false;
    setSlotsLoading(true);
    fetch(`${apiBase}/availability?${params.toString()}`, { cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json().catch(() => null) as { slots?: string[] } | null;
        if (!response.ok) throw new Error('availability_failed');
        if (!cancelled) {
          setServerAppointmentSlots(Array.isArray(data?.slots) ? data!.slots! : []);
          setAppointmentTime((current) => Array.isArray(data?.slots) && data.slots.includes(current) ? current : '');
        }
      })
      .catch(() => { if (!cancelled) { setServerAppointmentSlots([]); setAppointmentTime(''); } })
      .finally(() => { if (!cancelled) setSlotsLoading(false); });
    return () => { cancelled = true; };
  }, [apiBase, appointmentDate, cartSignature, needsReservedAppointment]);
  const appointmentSlots = needsReservedAppointment ? serverAppointmentSlots : localAppointmentSlots;
  const priced = lines.filter((l) => l.p.price_agorot !== null);
  const total = priced.reduce((s, l) => s + l.p.price_agorot! * l.q, 0);
  const hasQuote = lines.some((l) => l.p.price_agorot === null);
  const totalText = priced.length === 0 ? (hasQuote ? quoteLabel : '')
    : hasQuote ? `${ils(total)} + ${quoteLabel}` : ils(total);

  const setQty = (id: string, q: number) => {
    setAppointmentTime('');
    setCart((c) => {
      const n = { ...c };
      if (q <= 0) delete n[id]; else n[id] = Math.min(99, q);
      return n;
    });
  };

  const setField = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(route: Route) {
    setError(null);
    const phone = normalizeILPhone(form.phone);
    if (count === 0) return setError('יש לבחור לפחות מוצר או שירות אחד.');
    if (appointmentModes.length > 1) return setError('אי אפשר לשלב באותה הזמנה שירותים עם סוגי תיאום שונים. שלחו כל סוג תיאום בנפרד.');
    if (needsReservedAppointment && !hasAppointmentHours) return setError('לא הוגדרו שעות פעילות שמאפשרות לקבוע תור. יש לפנות לעסק ישירות.');
    if (appointmentTimeRequired && (!appointmentDate || !appointmentTime)) return setError('בחרו תאריך ושעה לשירות שדורש תיאום.');
    if (route === 'site' && !phone) return setError('נא להזין מספר טלפון ישראלי תקין.');
    if (needsReservedAppointment && !phone) return setError('כדי לשמור תור ביומן, יש להזין מספר טלפון ישראלי תקין.');

    setBusy(route);
    try {
      const requestKey = idempotencyKey || crypto.randomUUID();
      if (!idempotencyKey) setIdempotencyKey(requestKey);
      const res = await fetch(`${apiBase}/leads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          route,
          idempotency_key: requestKey,
          ...(route === 'site' || needsReservedAppointment ? { customer_phone: phone ?? undefined, ...(route === 'site' ? { customer_name: form.name.trim() || undefined, customer_email: form.email.trim() || undefined } : {}) } : {}),
          ...(needsAppointment && appointmentDate && appointmentTime ? { appointment_at: `${appointmentDate}T${appointmentTime}` } : {}),
          items: Object.entries(cart).map(([product_id, quantity]) => ({ product_id, quantity })),
          company_website: form.hp,
        }),
      });
      const data = await res.json().catch(() => null) as ApiErrorPayload | null;
      if (!res.ok) return setError(errorText(res.status, data));

      setIdempotencyKey('');
      if (data?.route === 'whatsapp' && data.whatsapp_url) {
        setDone({ route: 'whatsapp', url: data.whatsapp_url, message: data.success_message ?? 'הפנייה נשמרה. יש לשלוח את ההודעה כדי להשלים את הפנייה.' });
      } else {
        setCart({});
        setDone({ route: 'site', message: data?.success_message ?? 'הפנייה נשלחה בהצלחה.' });
      }
    } catch {
      setError('שגיאת רשת. נסו שוב.');
    } finally {
      setBusy(null);
    }
  }

  const input = 'mt-1 min-h-11 w-full rounded-xl border border-ink/25 bg-surface px-3 py-2 text-start';
  const openContinuation = () => { setError(null); setDone(null); setStep(flow.whatsapp_enabled && flow.site_inquiry_enabled ? 'choose' : flow.site_inquiry_enabled ? 'site' : 'choose'); dlg.current?.showModal(); };

  return (
    <section aria-labelledby="catalog-h" className={count ? 'pb-24' : ''}>
      <div className="flex items-center justify-between gap-3">
        <h2 id="catalog-h" className="text-2xl font-bold">{items.length ? 'מוצרים ושירותים' : 'יצירת קשר'}</h2>

      </div>

      {items.length > 0 && (
        <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((p) => {
            const q = cart[p.id] ?? 0;
            return (
              <li key={p.id} className="storefront-card flex flex-col overflow-hidden rounded-2xl border bg-white">
                {p.image && (
                  <div className="relative aspect-[4/3]">
                    <Image src={p.image.url} alt={p.name} fill sizes="(min-width:640px) 50vw, 100vw" className="object-cover" />
                  </div>
                )}
                <div className="flex flex-1 flex-col gap-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold">{p.name}</h3>
                    {p.kind === 'service' && (
                      <span className="shrink-0 rounded-full bg-secondary/30 px-2 py-0.5 text-xs">{p.requires_appointment ? `שירות · תור ${p.appointment_duration_minutes} דק׳` : 'שירות'}</span>
                    )}
                  </div>
                  {p.description && <p className="whitespace-pre-line text-sm leading-6 text-ink/70">{p.description}</p>}
                  <div className="mt-auto flex items-center justify-between gap-3 pt-2">
                    <span className="storefront-card-price text-lg font-extrabold">{p.price_agorot === null ? quoteLabel : ils(p.price_agorot)}</span>
                    {canOrder && (q > 0 ? (
                      <Stepper q={q} label={`כמות: ${p.name}`} onChange={(n) => setQty(p.id, n)} />
                    ) : (
                      <button type="button" onClick={() => setQty(p.id, 1)}
                        className="storefront-card-action rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-fg transition hover:opacity-90">
                        {p.price_agorot === null ? 'בקשת הצעת מחיר' : 'הוסף להזמנה'}
                      </button>
                    ))}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {catalogTotal > 0 && <div className="mt-5 flex flex-col items-center gap-2">
        <p className="text-sm text-ink/60">מוצגים {items.length} מתוך {catalogTotal} פריטים</p>
        {catalogError && <p role="alert" className="text-sm text-red-700">{catalogError}</p>}
        {hasMore && <button type="button" onClick={loadMore} disabled={loadingMore} className="min-h-11 rounded-full border border-ink/25 bg-white px-5 py-2.5 text-sm font-semibold text-ink hover:bg-ink/5 disabled:opacity-50">
          {loadingMore ? 'טוען פריטים…' : 'הצגת עוד פריטים'}
        </button>}
      </div>}

      {/* Sticky bar on bottom when cart has items */}
      {count > 0 && (
        <div className="fixed bottom-0 inset-x-0 z-40 flex items-center justify-between gap-4 border-t border-ink/15 bg-surface p-3 shadow-lg sm:p-4">
          <div>
            <div className="text-xs text-ink/70">{count} פריטים נבחרו</div>
            <div className="font-bold text-lg">{totalText}</div>
          </div>
          <button type="button" onClick={openContinuation}
            className="rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-fg hover:opacity-90">
            המשך להזמנה
          </button>
        </div>
      )}

      {/* Order Modal */}
      <dialog ref={dlg} className="m-auto max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-lg overflow-y-auto overscroll-contain rounded-2xl bg-surface p-4 text-start shadow-xl backdrop:bg-black/50 sm:max-h-[calc(100dvh-2rem)] sm:p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-bold">המשך להזמנה</h3>
          <button type="button" onClick={() => dlg.current?.close()} className="text-xl p-1">✕</button>
        </div>

        {!done && (
          <div className="mb-4 rounded-xl bg-gray-50 p-3">
            <ul className="space-y-1.5 text-sm">
              {lines.map(({ p, q }) => <li key={p.id} className="flex justify-between gap-3"><span>{p.name} × {q}{p.kind === 'service' && p.requires_appointment ? <span className="block text-xs text-ink/60">משך: {p.appointment_duration_minutes * q} דקות</span> : null}</span><span className="shrink-0 font-medium">{p.price_agorot === null ? quoteLabel : ils(p.price_agorot * q)}</span></li>)}
            </ul>
            {totalText && <div className="mt-3 flex justify-between border-t border-gray-200 pt-2 font-bold"><span>סכום משוער</span><span>{totalText}</span></div>}
          </div>
        )}

        {!done && needsAppointment && (
          <fieldset className="mb-4 space-y-3 rounded-xl border border-ink/15 p-3">
            <legend className="px-1 text-sm font-semibold">תיאום תור</legend>
            {hasAppointmentHours ? (
              <>
                <p className="text-xs leading-5 text-ink/65">משך התור: {appointmentDurationMinutes} דקות בסך הכול. {needsReservedAppointment ? 'בחרו שעה פנויה; התור יישמר ביומן לאחר שמירת הבקשה.' : 'בחרו מועד מבוקש. הוא לא תופס את היומן והעסק יתאם אתכם.'}</p>
                <label className="block text-sm font-medium">תאריך
                  <input type="date" required min={new Date().toLocaleDateString('en-CA')} value={appointmentDate} onChange={(e) => { setAppointmentDate(e.target.value); setAppointmentTime(''); }} className={input} />
                </label>
                <label className="block text-sm font-medium">שעה
                  <select required value={appointmentTime} onChange={(e) => setAppointmentTime(e.target.value)} disabled={!appointmentDate || slotsLoading || appointmentSlots.length === 0} className={input}>
                    <option value="">{!appointmentDate ? 'קודם בחרו תאריך' : slotsLoading ? 'בודקים שעות פנויות…' : appointmentSlots.length ? 'בחירת שעה' : 'אין שעות פנויות ביום זה'}</option>
                    {appointmentSlots.map((slot) => <option key={slot} value={slot}>{slot}</option>)}
                  </select>
                </label>
              </>
            ) : (
              <p className="text-sm leading-6 text-ink/75">{needsReservedAppointment ? 'לא הוגדרו שעות פעילות שמאפשרות לקבוע תור. פנו לעסק ישירות כדי לתאם.' : `העסק עדיין לא הגדיר שעות פעילות. אפשר לשלוח את הבקשה ללא מועד, והמוכר יתאם איתכם את התור. משך התור הכולל: ${appointmentDurationMinutes} דקות.`}</p>
            )}
          </fieldset>
        )}

        {done ? (
          <div className="py-4 text-center">
            <p className="mb-4 text-lg font-medium text-green-700">
              {done.message}
            </p>
            {done.route === 'whatsapp' && <a href={done.url} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[#168A52] px-5 py-2 font-bold text-white">פתיחת WhatsApp</a>}
            <button type="button" onClick={() => { setDone(null); dlg.current?.close(); }}
              className="ms-2 min-h-11 rounded-xl border border-ink/25 px-5 py-2">סגור</button>
          </div>
        ) : step === 'choose' ? (
          <div className="space-y-3">
            {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
            {needsReservedAppointment && (
              <div>
                <label htmlFor="reserved-phone" className="block text-sm font-medium">מספר טלפון לשמירת התור *</label>
                <input id="reserved-phone" name="tel" autoComplete="tel" dir="ltr" type="tel" required className={input} value={form.phone} onChange={setField('phone')} placeholder="0500000000" />
                <p className="mt-1 text-xs text-ink/60">התור נשמר ביומן לפני המעבר ל־WhatsApp. לשינוי או לביטול יש לפנות לעסק ישירות.</p>
              </div>
            )}
            {flow.whatsapp_enabled && (
              <button type="button" disabled={busy !== null} onClick={() => submit('whatsapp')}
                className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#168A52] px-4 py-3 font-bold text-white hover:bg-[#117443] disabled:opacity-50">
                {busy === 'whatsapp' ? 'מכין הודעה…' : 'המשך ל־WhatsApp'}
              </button>
            )}
            {flow.site_inquiry_enabled && (
              <button type="button" onClick={() => { setError(null); setStep('site'); }}
                className="min-h-12 w-full rounded-xl bg-primary px-4 py-3 font-bold text-primary-fg hover:opacity-90">
                השארת פנייה באתר
              </button>
            )}
            <p className="text-center text-xs leading-5 text-ink/60">הפריטים שבחרתם יצורפו לפנייה. מעבר ל־WhatsApp לא שולח את ההודעה במקומכם.</p>
          </div>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); submit('site'); }} className="space-y-3">
            {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
            <input type="text" tabIndex={-1} className="hidden" value={form.hp} onChange={setField('hp')} autoComplete="off" />
            <div>
              <label htmlFor="lead-name" className="block text-sm font-medium">שם (רשות)</label>
              <input id="lead-name" name="name" autoComplete="name" type="text" className={input} value={form.name} onChange={setField('name')} />
            </div>
            <div>
              <label htmlFor="lead-phone" className="block text-sm font-medium">מספר טלפון *</label>
              <input id="lead-phone" name="tel" autoComplete="tel" dir="ltr" type="tel" required className={input} value={form.phone} onChange={setField('phone')} placeholder="0500000000" />
            </div>
            <div>
              <label htmlFor="lead-email" className="block text-sm font-medium">אימייל (רשות)</label>
              <input id="lead-email" name="email" autoComplete="email" dir="ltr" type="email" className={input} value={form.email} onChange={setField('email')} />
            </div>
            <div className="flex gap-2 pt-2">
              {flow.whatsapp_enabled && <button type="button" onClick={() => { setError(null); setStep('choose'); }}
                className="min-h-12 flex-1 rounded-xl border border-ink/20 px-4 py-3 font-semibold">חזרה</button>}
              <button type="submit" disabled={busy !== null}
                className="min-h-12 flex-1 rounded-xl bg-primary px-4 py-3 font-bold text-primary-fg disabled:opacity-50">
                {busy === 'site' ? 'שולח…' : 'שליחת הפנייה'}
              </button>
            </div>
          </form>
        )}
      </dialog>
    </section>
  );
}