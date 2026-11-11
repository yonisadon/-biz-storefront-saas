'use client';

import Image from 'next/image';
import ReadMoreText from '@/components/ReadMoreText';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ils, normalizeILPhone } from '@/lib/format';
import type { DayHours, OrderFlow, Product, PublicCatalogPage } from '@/lib/types';

type Layout = 'cards' | 'gallery' | 'list' | 'grid' | 'carousel' | 'luxury_catalog';
type Props = { apiBase: string; items: Product[]; quoteLabel: string; flow: OrderFlow; openingHours: Record<string, DayHours> | null; catalogTotal: number; hasMore: boolean; productLayout: Layout; serviceLayout: Layout };
type Route = 'whatsapp' | 'site';
type Done = { route: 'site'; message: string } | { route: 'whatsapp'; url: string; message: string };
type Step = 'choose' | 'site';

type ApiErrorPayload = { issues?: { message: string }[]; error?: string; route?: string; whatsapp_url?: string; success_message?: string };

function errorText(status: number, d: ApiErrorPayload | null): string {
  if (status === 429) return 'בוצעו יותר מדי ניסיונות. נסו שוב בעוד דקה.';
  if (status === 403) return 'הגדרות העסק השתנו מאז פתיחת האתר. רעננו את הדף ונסו שוב.';
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
  return 'לא הצלחנו לשלוח. נסו שוב.';
}

function Stepper({ q, onChange, label }: { q: number; onChange: (n: number) => void; label: string }) {
  const btn = 'h-9 w-9 rounded-full border-0 text-lg leading-none flex items-center justify-center text-primary transition hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
  return (
    <div className="flex items-center gap-1" role="group" aria-label={label}>
      <button type="button" className={btn} aria-label="הפחתת כמות" onClick={() => onChange(q - 1)}>−</button>
      <span className="w-8 text-center font-semibold" aria-live="polite">{q}</span>
      <button type="button" className={btn} aria-label="הוספת כמות" onClick={() => onChange(q + 1)}>+</button>
    </div>
  );
}

function ProductImageGallery({ product }: { product: Product }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const touchStart = useRef<number | null>(null);
  const images = [
    ...(product.image ? [{ id: 'primary', url: product.image.url, width: product.image.width, height: product.image.height }] : []),
    ...(product.additional_images ?? []),
  ];
  const [active, setActive] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  useEffect(() => {
    if (!lightboxOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [lightboxOpen]);
  if (!images.length) return null;
  const show = (index: number) => { setActive(index); dialog.current?.showModal(); setLightboxOpen(true); };
  const move = (delta: number) => setActive((index) => (index + delta + images.length) % images.length);
  return (
    <div>
      <button type="button" onClick={() => show(active)} aria-label={`הגדלת תמונת ${product.name}; פתיחת גלריית תמונות`} aria-haspopup="dialog" className="group relative block aspect-[4/3] w-full cursor-zoom-in overflow-hidden bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-primary">
        <Image src={images[active].url} alt={product.name} fill sizes="(min-width:1024px) 33vw, (min-width:640px) 50vw, 100vw" className="object-cover transition-transform duration-300 ease-out group-hover:scale-[1.03] group-focus-visible:scale-[1.03]" />
        <span aria-hidden="true" className="absolute end-3 top-3 grid h-10 w-10 place-items-center rounded-full bg-black/65 text-white shadow-md transition-colors group-hover:bg-black/80">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5"><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4.5 4.5M10.8 7.5v6.6M7.5 10.8h6.6" /></svg>
        </span>
        <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/65 to-transparent px-3 pb-3 pt-8 text-start text-xs font-medium text-white opacity-100 sm:opacity-0 sm:transition-opacity sm:duration-200 sm:group-hover:opacity-100 sm:group-focus-visible:opacity-100">לחצו להגדלה</span>
      </button>
      {images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto p-2" role="group" aria-label="תמונות נוספות">
          {images.map((image, index) => (
            <button key={image.id} type="button" onClick={() => setActive(index)} aria-label={`הצגת תמונה ${index + 1} מתוך ${images.length}`} aria-pressed={active === index}
              className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border-2 border-transparent aria-pressed:border-primary focus-visible:outline-2 focus-visible:outline-offset-2">
              <Image src={image.url} alt="" fill sizes="56px" className="object-cover" />
            </button>
          ))}
        </div>
      )}
      <dialog ref={dialog} aria-label={`גלריית תמונות: ${product.name}`} onClose={() => setLightboxOpen(false)} onClick={(event) => {
        if (event.target === dialog.current) dialog.current?.close();
      }} onKeyDown={(event) => {
        if (event.key === 'ArrowRight') { event.preventDefault(); move(1); }
        if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1); }
      }} className="m-auto max-h-[96dvh] w-[calc(100%-1rem)] max-w-5xl rounded-2xl border border-white/10 bg-neutral-950 p-3 text-white shadow-2xl backdrop:bg-black/85 sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="min-w-0 whitespace-normal break-words text-sm font-semibold [overflow-wrap:anywhere] sm:text-base">{product.name}</p>
            <p className="text-xs text-white/65">תצוגת תמונה מוגדלת · {active + 1} מתוך {images.length}</p>
          </div>
          <button type="button" onClick={() => dialog.current?.close()} autoFocus className="grid min-h-11 min-w-11 place-items-center rounded-full border border-white/30 bg-white/10 text-xl transition hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white" aria-label="סגירת גלריית התמונות">✕</button>
        </div>
        <div
          className="relative mx-auto flex h-[min(68dvh,720px)] w-full touch-pan-y items-center justify-center overflow-hidden rounded-xl bg-black"
          onTouchStart={(event) => { touchStart.current = event.touches[0]?.clientX ?? null; }}
          onTouchEnd={(event) => {
            if (touchStart.current === null || images.length < 2) return;
            const delta = (event.changedTouches[0]?.clientX ?? touchStart.current) - touchStart.current;
            if (Math.abs(delta) > 45) move(delta < 0 ? 1 : -1);
            touchStart.current = null;
          }}
        >
          <Image src={images[active].url} alt={`${product.name}, תמונה ${active + 1}`} fill sizes="90vw" className="object-contain" />
        </div>
        {images.length > 1 && (
          <div className="mt-3 flex justify-center gap-2 overflow-x-auto pb-1" role="group" aria-label="בחירת תמונה בגלריה">
            {images.map((image, index) => (
              <button key={image.id} type="button" onClick={() => setActive(index)} aria-label={`מעבר לתמונה ${index + 1}`} aria-pressed={active === index}
                className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg border-2 border-white/20 opacity-65 transition aria-pressed:border-white aria-pressed:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
                <Image src={image.url} alt="" fill sizes="48px" className="object-cover" />
              </button>
            ))}
          </div>
        )}
        <p className="mt-2 text-center text-[11px] text-white/55">אפשר לסגור עם Esc או בלחיצה מחוץ לתמונה</p>
      </dialog>
    </div>
  );
}

export default function OrderSection({ apiBase, items: initialItems, quoteLabel, flow, openingHours, catalogTotal, hasMore: initiallyHasMore, productLayout, serviceLayout }: Props) {
  const dlg = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const sectionHeadingRef = useRef<HTMLHeadingElement>(null);
  const successRef = useRef<HTMLParagraphElement>(null);
  const [items, setItems] = useState<Product[]>(initialItems);
  const [nextOffset, setNextOffset] = useState(initialItems.length);
  const [hasMore, setHasMore] = useState(initiallyHasMore);
  const [loadingMore, setLoadingMore] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [searchTotal, setSearchTotal] = useState(catalogTotal);
  const [searching, setSearching] = useState(false);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [form, setForm] = useState({ name: '', phone: '', email: '', hp: '' });
  const [appointmentDate, setAppointmentDate] = useState('');
  const [appointmentMonth, setAppointmentMonth] = useState(() => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`; });
  const [monthAvailableDates, setMonthAvailableDates] = useState<string[]>([]);
  const [monthLoading, setMonthLoading] = useState(false);
  const [monthError, setMonthError] = useState(false);
  const [appointmentTime, setAppointmentTime] = useState('');
  const [serverAppointmentSlots, setServerAppointmentSlots] = useState<string[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState(false);
  const [step, setStep] = useState<Step>('choose');
  const [busy, setBusy] = useState<Route | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const [waitlistDone, setWaitlistDone] = useState(false);
  const [waitlistBusy, setWaitlistBusy] = useState(false);
  const [waitlistError, setWaitlistError] = useState<string | null>(null);
  const [waitlistName, setWaitlistName] = useState('');
  const [waitlistPreferredTime, setWaitlistPreferredTime] = useState('');
  const [waitlistNote, setWaitlistNote] = useState('');

  useEffect(() => {
    if (done) successRef.current?.focus();
  }, [done]);

  const canOrder = flow.whatsapp_enabled || flow.site_inquiry_enabled;
  const calendarOnlyAvailable = !flow.whatsapp_enabled && !flow.site_inquiry_enabled;
  useEffect(() => {
    const term = search.trim();
    if (!term) {
      setItems(initialItems);
      setNextOffset(initialItems.length);
      setHasMore(initiallyHasMore);
      setSearchTotal(catalogTotal);
      setCatalogError(null);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    setCatalogError(null);
    const params = new URLSearchParams({ search: term, limit: '12', offset: '0' });
    fetch(`${apiBase}/catalog?${params.toString()}`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('catalog_search_failed');
        return await response.json() as PublicCatalogPage;
      })
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setNextOffset(page.offset + page.items.length);
        setHasMore(page.has_more);
        setSearchTotal(page.total);
      })
      .catch(() => { if (!cancelled) setCatalogError('לא הצלחנו לחפש כרגע. נסו שוב.'); })
      .finally(() => { if (!cancelled) setSearching(false); });
    return () => { cancelled = true; };
  }, [apiBase, search, initialItems, initiallyHasMore, catalogTotal]);

  async function loadMore() {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true); setCatalogError(null);
    try {
      const params = new URLSearchParams({ limit: '12', offset: String(nextOffset) });
      if (search.trim()) params.set('search', search.trim());
      const response = await fetch(`${apiBase}/catalog?${params.toString()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('catalog_request_failed');
      const page = await response.json() as PublicCatalogPage;
      setItems((current) => { const known = new Set(current.map((item) => item.id)); return [...current, ...page.items.filter((item) => !known.has(item.id))]; });
      setNextOffset(page.offset + page.items.length); setHasMore(page.has_more); setSearchTotal(page.total);
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
  const needsAppointment = appointmentLines.length > 0;
  const reservedAppointmentLines = appointmentLines.filter(({ p }) => modeOf(p) === 'availability');
  const freeDatetimeLines = appointmentLines.filter(({ p }) => modeOf(p) === 'free_datetime');
  const needsReservedAppointment = reservedAppointmentLines.length > 0;
  const needsFreeDatetimeAppointment = freeDatetimeLines.length > 0;
  const calendarOnlySelection = needsReservedAppointment && lines.length > 0 && lines.every(({ p }) => p.kind === 'service' && modeOf(p) === 'availability');
  const calendarOnlyFlow = calendarOnlySelection && !flow.whatsapp_enabled && !flow.site_inquiry_enabled;
  const reservedAppointmentDurationMinutes = reservedAppointmentLines.reduce((sum, { p, q }) => sum + p.appointment_duration_minutes * q, 0);
  const freeDatetimeDurationMinutes = freeDatetimeLines.reduce((sum, { p, q }) => sum + p.appointment_duration_minutes * q, 0);
  const appointmentDurationMinutes = needsReservedAppointment ? reservedAppointmentDurationMinutes : freeDatetimeDurationMinutes;
  const cartSignature = useMemo(() => Object.entries(cart).sort(([a], [b]) => a.localeCompare(b)).map(([id, quantity]) => `${id}:${quantity}`).join(','), [cart]);
  const hasAppointmentHours = useMemo(
    () => Object.values(openingHours ?? {}).some((ranges) => Array.isArray(ranges) && ranges.length > 0),
    [openingHours],
  );
  const appointmentTimeRequired = needsAppointment && (needsReservedAppointment || hasAppointmentHours);
  useEffect(() => {
    if (!needsAppointment || !cartSignature || !hasAppointmentHours) {
      setMonthAvailableDates([]);
      setMonthLoading(false);
      return;
    }
    const params = new URLSearchParams({ month: appointmentMonth, items: cartSignature });
    let cancelled = false;
    setMonthLoading(true);
    setMonthError(false);
    fetch(`${apiBase}/availability/month?${params.toString()}`, { cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json().catch(() => null) as { available_dates?: string[] } | null;
        if (!response.ok) throw new Error('availability_month_failed');
        if (!cancelled) setMonthAvailableDates(Array.isArray(data?.available_dates) ? data.available_dates : []);
      })
      .catch(() => { if (!cancelled) { setMonthError(true); setMonthAvailableDates([]); } })
      .finally(() => { if (!cancelled) setMonthLoading(false); });
    return () => { cancelled = true; };
  }, [apiBase, appointmentMonth, cartSignature, hasAppointmentHours, needsAppointment]);
  const monthCells = useMemo(() => {
    const [year, month] = appointmentMonth.split('-').map(Number);
    const firstWeekday = new Date(Date.UTC(year, month - 1, 1, 12)).getUTCDay();
    const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return Array.from({ length: firstWeekday + count }, (_, index) => {
      if (index < firstWeekday) return null;
      return `${year}-${String(month).padStart(2, '0')}-${String(index - firstWeekday + 1).padStart(2, '0')}`;
    });
  }, [appointmentMonth]);
  const moveAppointmentMonth = (delta: number) => {
    const [year, month] = appointmentMonth.split('-').map(Number);
    const next = new Date(Date.UTC(year, month - 1 + delta, 1, 12));
    setAppointmentMonth(`${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`);
  };
  const appointmentMonthLabel = new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${appointmentMonth}-01T12:00:00Z`));
  const todayDate = new Date().toLocaleDateString('en-CA');
  const appointmentSlots = serverAppointmentSlots;
  const appointmentTimeGroups = [
    { label: 'בוקר', slots: appointmentSlots.filter((slot) => Number(slot.slice(0, 2)) < 12) },
    { label: 'צהריים', slots: appointmentSlots.filter((slot) => Number(slot.slice(0, 2)) >= 12 && Number(slot.slice(0, 2)) < 17) },
    { label: 'ערב', slots: appointmentSlots.filter((slot) => Number(slot.slice(0, 2)) >= 17) },
  ];
  useEffect(() => {
    if (!needsAppointment || !appointmentDate || !cartSignature) {
      setServerAppointmentSlots([]);
      setSlotsLoading(false);
      return;
    }
    const params = new URLSearchParams({ date: appointmentDate, items: cartSignature });
    let cancelled = false;
    setSlotsLoading(true);
    setSlotsError(false);
    fetch(`${apiBase}/availability?${params.toString()}`, { cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json().catch(() => null) as { slots?: string[] } | null;
        if (!response.ok) throw new Error('availability_failed');
        if (!cancelled) {
          setServerAppointmentSlots(Array.isArray(data?.slots) ? data!.slots! : []);
          setAppointmentTime((current) => Array.isArray(data?.slots) && data.slots.includes(current) ? current : '');
        }
      })
      .catch(() => { if (!cancelled) { setSlotsError(true); setServerAppointmentSlots([]); setAppointmentTime(''); } })
      .finally(() => { if (!cancelled) setSlotsLoading(false); });
    return () => { cancelled = true; };
  }, [apiBase, appointmentDate, cartSignature, needsAppointment]);
  // Both reserved and free-datetime services use the same server-generated
  // quarter-hour grid. Only availability-mode services block calendar time.
  const priced = lines.filter((l) => l.p.price_agorot !== null);
  const total = priced.reduce((s, l) => s + l.p.price_agorot! * l.q, 0);
  const hasQuote = lines.some((l) => l.p.price_agorot === null);
  const totalText = priced.length === 0 ? (hasQuote ? quoteLabel : '')
    : hasQuote ? `${ils(total)} + ${quoteLabel}` : ils(total);

  const setQty = (id: string, q: number) => {
    setIdempotencyKey('');
    setAppointmentTime('');
    setCart((c) => {
      const n = { ...c };
      if (q <= 0) delete n[id]; else n[id] = Math.min(99, q);
      return n;
    });
  };

  const setField = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setIdempotencyKey('');
      setForm((f) => ({ ...f, [k]: e.target.value }));
    };

  async function submit(route: Route) {
    setError(null);
    const phone = normalizeILPhone(form.phone);
    if (count === 0) return setError('יש לבחור לפחות מוצר או שירות אחד.');
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
          ...(route === 'site' || needsReservedAppointment ? { customer_phone: phone ?? undefined, ...(route === 'site' && flow.site_inquiry_enabled ? { customer_name: form.name.trim() || undefined, customer_email: form.email.trim() || undefined } : {}) } : {}),
          ...(needsAppointment && appointmentDate && appointmentTime ? { appointment_at: `${appointmentDate}T${appointmentTime}` } : {}),
          items: Object.entries(cart).map(([product_id, quantity]) => ({ product_id, quantity })),
          company_website: form.hp,
        }),
      });
      const data = await res.json().catch(() => null) as ApiErrorPayload | null;
      if (!res.ok) return setError(errorText(res.status, data));

      // The server has confirmed persistence. Clear the order immediately so
      // returning from WhatsApp cannot accidentally submit the same cart again.
      setIdempotencyKey('');
      setCart({});
      setAppointmentDate('');
      setAppointmentTime('');
      setServerAppointmentSlots([]);
      if (data?.route === 'whatsapp' && data.whatsapp_url) {
        setDone({ route: 'whatsapp', url: data.whatsapp_url, message: data.success_message ?? 'הפנייה נשמרה. יש לשלוח את ההודעה כדי להשלים את הפנייה.' });
      } else {
        setDone({ route: 'site', message: data?.success_message ?? 'הפנייה נשלחה בהצלחה.' });
      }
    } catch {
      setError('שגיאת רשת. נסו שוב.');
    } finally {
      setBusy(null);
    }
  }

  async function submitWaitlist(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWaitlistError(null);
    if (!appointmentDate) return setWaitlistError('בחרו תאריך מועדף.');
    const phone = normalizeILPhone(form.phone);
    if (!phone) return setWaitlistError('נא להזין מספר טלפון ישראלי תקין.');
    setWaitlistBusy(true);
    try {
      const response = await fetch(`${apiBase}/waitlist`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          customer_name: waitlistName.trim() || undefined,
          customer_phone: phone,
          service_ids: reservedAppointmentLines.map(({ p }) => p.id),
          preferred_date: appointmentDate,
          ...(waitlistPreferredTime ? { preferred_time: waitlistPreferredTime } : {}),
          note: waitlistNote.trim(),
          company_website: '',
        }),
      });
      const data = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) {
        if (response.status === 409 || data?.error === 'duplicate_waitlist_request') {
          setWaitlistError('כבר קיימת בקשת המתנה פעילה עם אותם פרטים.');
        } else if (response.status === 429) {
          setWaitlistError('נשלחו יותר מדי בקשות. נסו שוב מאוחר יותר.');
        } else {
          setWaitlistError('לא הצלחנו להצטרף לרשימת ההמתנה. בדקו את הפרטים ונסו שוב.');
        }
        return;
      }
      setWaitlistDone(true);
      setWaitlistOpen(false);
    } catch {
      setWaitlistError('שגיאת רשת. נסו שוב.');
    } finally {
      setWaitlistBusy(false);
    }
  }

  const input = 'mt-1 min-h-11 w-full rounded-xl border border-ink/25 bg-surface px-3 py-2 text-start';
  const openContinuation = () => {
    setError(null);
    setDone(null);
    setStep(calendarOnlyFlow ? 'site' : flow.whatsapp_enabled && flow.site_inquiry_enabled ? 'choose' : flow.site_inquiry_enabled ? 'site' : 'choose');
    dlg.current?.showModal();
  };

  return (
    <section aria-labelledby="catalog-h" className={count ? 'pb-24' : ''}>
      <div className="flex items-center justify-between gap-3">
        <h2 ref={sectionHeadingRef} id="catalog-h" tabIndex={-1} className="text-2xl font-bold">{items.length || search.trim() ? 'מוצרים ושירותים' : 'יצירת קשר'}</h2>
      </div>

      {catalogTotal >= 5 && (
        <div className="mt-4">
          <label htmlFor="storefront-product-search" className="sr-only">חיפוש מוצרים ושירותים</label>
          <input id="storefront-product-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="חיפוש לפי שם או תיאור…" className="min-h-11 w-full rounded-xl border border-ink/20 bg-white px-4 py-2 text-start focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" />
        </div>
      )}
      {searching && <p role="status" className="mt-3 text-sm text-ink/65">מחפשים פריטים…</p>}
      {!searching && search.trim() && items.length === 0 && !catalogError && <p className="mt-4 text-sm text-ink/65">לא נמצאו פריטים התואמים לחיפוש.</p>}

      {items.length > 0 && (
        <div className="mt-5 space-y-8">
          {(['product', 'service'] as const).map((kind) => {
            const groupItems = items.filter((item) => item.kind === kind);
            if (!groupItems.length) return null;
            const layout = kind === 'product' ? productLayout : serviceLayout;
            return <section key={kind} aria-label={kind === 'product' ? 'מוצרים' : 'שירותים'}>
              {items.some((item) => item.kind === 'product') && items.some((item) => item.kind === 'service') && <h3 className="mb-3 text-lg font-bold">{kind === 'product' ? 'מוצרים' : 'שירותים'}</h3>}
              <ul data-storefront-list data-kind={kind} data-layout={layout} className="storefront-items-list">
          {groupItems.map((p) => {
            const q = cart[p.id] ?? 0;
            return (
              <li key={p.id} data-has-image={Boolean(p.image || p.additional_images?.length) ? 'true' : 'false'} className="storefront-card flex flex-col overflow-hidden rounded-2xl border bg-white">
                <ProductImageGallery product={p} />
                <div className="flex min-w-0 flex-col gap-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="min-w-0 flex-1 break-words [writing-mode:horizontal-tb] font-semibold">{p.name}</h3>
                    {p.kind === 'service' && (
                      <span className="shrink-0 rounded-full bg-secondary/30 px-2 py-0.5 text-xs">{modeOf(p) === 'availability' ? `שירות · תור ביומן ${p.appointment_duration_minutes} דק׳` : modeOf(p) === 'free_datetime' ? `שירות · מועד מבוקש ${p.appointment_duration_minutes} דק׳` : 'שירות'}</span>
                    )}
                  </div>
                  {p.description && <ReadMoreText text={p.description} className="storefront-description text-sm leading-6 text-ink/70" />}
                  {p.details?.length > 0 && (
                    <details className="border-t border-ink/10 pt-3 text-sm">
                      <summary className="cursor-pointer font-semibold text-primary underline underline-offset-2">פרטים נוספים ({p.details.length})</summary>
                      <dl className="mt-2 divide-y divide-ink/10">
                        {p.details.map((detail, index) => <div key={index} className="grid grid-cols-[minmax(5rem,0.8fr)_minmax(0,1.2fr)] items-start gap-3 py-2 first:pt-0">
                          <dt className="min-w-0 break-words text-ink/60">{detail.label}</dt><dd className="min-w-0 break-words font-medium">{detail.value}</dd>
                        </div>)}
                      </dl>
                    </details>
                  )}
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink/10 pt-3">
                    <span className="storefront-card-price text-lg font-extrabold">{p.price_agorot === null ? quoteLabel : ils(p.price_agorot)}</span>
                    {(canOrder || (p.kind === 'service' && modeOf(p) === 'availability')) && (q > 0 ? (
                      <Stepper q={q} label={`כמות: ${p.name}`} onChange={(n) => setQty(p.id, n)} />
                    ) : (
                      <button type="button" onClick={() => setQty(p.id, 1)}
                        className="storefront-card-action rounded-full border border-ink/15 bg-transparent px-4 py-2 text-sm font-semibold text-ink/85 transition hover:border-primary/35 hover:bg-primary/5">
                        {calendarOnlyAvailable && p.kind === 'service' && modeOf(p) === 'availability' ? 'קביעת תור' : p.price_agorot === null ? 'בקשת הצעת מחיר' : 'הוסף להזמנה'}
                      </button>
                    ))}
                  </div>
                </div>
              </li>
            );
          })}
              </ul>
            </section>;
          })}
        </div>
      )}

      {(search.trim() ? searchTotal : catalogTotal) > 0 && <div className="mt-5 flex flex-col items-center gap-2">
        <p className="text-sm text-ink/60">מוצגים {items.length} מתוך {search.trim() ? searchTotal : catalogTotal} פריטים</p>
        {catalogError && <p role="alert" className="text-sm text-red-700">{catalogError}</p>}
        {hasMore && <button type="button" onClick={loadMore} disabled={loadingMore} className="min-h-11 rounded-full border border-ink/25 bg-white px-5 py-2.5 text-sm font-semibold text-ink hover:bg-ink/5 disabled:opacity-50">
          {loadingMore ? 'טוען פריטים…' : 'הצגת עוד פריטים'}
        </button>}
      </div>}

      {/* Sticky bar on bottom when cart has items */}
      {count > 0 && (
        <div className="fixed bottom-0 inset-x-0 z-40 flex items-center justify-between gap-4 border-t border-ink/10 bg-surface/95 p-3 shadow-sm backdrop-blur-sm sm:p-4">
          <div>
            <div className="text-xs text-ink/70">{count} פריטים נבחרו</div>
            <div className="font-bold text-lg">{totalText}</div>
          </div>
          <button ref={openerRef} type="button" onClick={openContinuation}
            className="min-h-11 rounded-full border-0 bg-primary/10 px-6 py-2.5 text-sm font-medium text-primary transition hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
            המשך להזמנה
          </button>
        </div>
      )}

      {/* Order Modal */}
      <dialog ref={dlg} aria-labelledby="order-dialog-title" onClose={() => (openerRef.current ?? sectionHeadingRef.current)?.focus()} className="customer-order-dialog m-auto max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-lg overflow-y-auto overscroll-contain rounded-2xl bg-surface p-4 text-start shadow-xl backdrop:bg-black/50 sm:max-h-[calc(100dvh-2rem)] sm:p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 id="order-dialog-title" className="text-xl font-bold">המשך להזמנה</h3>
          <button type="button" onClick={() => dlg.current?.close()} aria-label={done ? "סגירת הודעת האישור; התור נשאר שמור" : "סגירת חלון ההזמנה"} className="min-h-11 min-w-11 rounded-lg border border-ink/20 p-2 text-xl focus-visible:outline-2 focus-visible:outline-offset-2">✕</button>
        </div>

        {!done && (
          <div className="mb-4 rounded-xl bg-gray-50 p-3">
            <ul className="space-y-1.5 text-sm">
              {lines.map(({ p, q }) => {
                const mode = p.kind === 'service' ? modeOf(p) : 'none';
                const durationLabel = mode === 'availability' ? 'משך שמשוריין ביומן' : mode === 'free_datetime' ? 'משך מבוקש, ללא שריון' : '';
                return <li key={p.id} className="flex flex-wrap items-center justify-between gap-3">
                  <span className="min-w-0 flex-1">{p.name} × {q}{durationLabel ? <span className="block text-xs text-ink/60">{durationLabel}: {p.appointment_duration_minutes * q} דקות</span> : null}</span>
                  <span className="shrink-0 font-medium">{p.price_agorot === null ? quoteLabel : ils(p.price_agorot * q)}</span>
                  {!done && p.kind === 'service' && (
                    <div className="flex w-full items-center justify-between gap-3 border-t border-gray-200 pt-2">
                      <Stepper q={q} label={`כמות: ${p.name}`} onChange={(next) => setQty(p.id, next)} />
                      <button type="button" onClick={() => setQty(p.id, 0)} className="min-h-9 rounded-lg px-3 text-sm font-medium text-red-700 underline underline-offset-2">הסרת השירות</button>
                    </div>
                  )}
                </li>;
              })}
            </ul>
            {totalText && <div className="mt-3 flex justify-between border-t border-gray-200 pt-2 font-bold"><span>סכום משוער</span><span>{totalText}</span></div>}
          </div>
        )}

        {!done && needsAppointment && (
          <fieldset className="mb-4 space-y-3 rounded-xl border border-ink/15 p-3">
            <legend className="px-1 text-sm font-semibold">תיאום תור</legend>
            {hasAppointmentHours ? (
              <>
                <p className="text-xs leading-5 text-ink/65">{needsReservedAppointment ? `משך השריון ביומן: ${reservedAppointmentDurationMinutes} דקות. בחרו שעה פנויה; התור יישמר ביומן לאחר שמירת הבקשה.` : `משך השירותים שמבקשים לתאם: ${freeDatetimeDurationMinutes} דקות. המועד המבוקש לא תופס את היומן והעסק יתאם אתכם.`}{needsReservedAppointment && needsFreeDatetimeAppointment ? ` שירותים נוספים ללא שריון: ${freeDatetimeLines.map(({ p }) => p.name).join(', ')}; הם לא מוסיפים זמן לשריון ביומן.` : ''}</p>
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">בחירת תאריך</span>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => { const [y, m] = appointmentMonth.split('-').map(Number); const today = new Date(); const minMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`; if (`${y}-${String(m).padStart(2, '0')}` > minMonth) moveAppointmentMonth(-1); }} aria-label="חודש קודם" className="grid h-9 w-9 place-items-center rounded-full border border-ink/20 disabled:opacity-40">‹</button>
                      <span className="min-w-28 text-center font-semibold capitalize">{appointmentMonthLabel}</span>
                      <button type="button" onClick={() => moveAppointmentMonth(1)} aria-label="חודש הבא" className="grid h-9 w-9 place-items-center rounded-full border border-ink/20">›</button>
                      <button type="button" onClick={() => { const today = new Date(); const month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`; setAppointmentMonth(month); }} className="rounded-full px-3 py-2 text-xs font-medium text-primary underline underline-offset-2">החודש</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-7 gap-1 text-center text-xs text-ink/55">{['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'].map((day) => <span key={day} className="py-1">{day}</span>)}</div>
                  <div className="grid grid-cols-7 gap-1">
                    {monthCells.map((date, index) => {
                      if (!date) return <span key={`empty-${index}`} aria-hidden="true" />;
                      const available = monthAvailableDates.includes(date);
                      const disabled = date < todayDate || !available || monthLoading || monthError;
                      const selected = appointmentDate === date;
                      return <button key={date} type="button" disabled={disabled} aria-pressed={selected} onClick={() => { setIdempotencyKey(''); setAppointmentDate(date); setAppointmentTime(''); }}
                        aria-label={`יום ${Number(date.slice(-2))}${available ? ', יש שעות פנויות' : ', לא זמין'}`} className={`min-h-11 rounded-xl text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-30 ${selected ? 'bg-primary/10 text-primary ring-1 ring-primary/25' : available ? 'bg-primary/5 text-ink hover:bg-primary/10' : 'text-ink/35'}`}>
                        {Number(date.slice(-2))}{available && <span className="mx-auto mt-0.5 block h-1 w-1 rounded-full bg-current" aria-hidden="true" />}
                      </button>;
                    })}
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-[11px] text-ink/60"><span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-primary"/> יש שעות פנויות</span><span>ימים אפורים אינם זמינים</span></div>
                  {monthLoading && <p role="status" className="text-xs text-ink/60">בודקים זמינות לחודש…</p>}
                  {monthError && <p role="alert" className="text-xs text-red-700">לא הצלחנו לטעון את זמינות החודש. נסו לרענן את הדף.</p>}
                </div>
                <div className="space-y-2">
                  <span className="text-sm font-semibold">שעות פנויות</span>
                  {!appointmentDate && <p className="text-sm text-ink/55">בחרו יום שבו מופיע סימון של זמינות.</p>}
                  {appointmentDate && slotsLoading && <p role="status" className="text-sm text-ink/55">בודקים שעות פנויות ליום שנבחר…</p>}
                  {appointmentDate && slotsError && <p role="alert" className="text-sm text-red-700">לא הצלחנו לבדוק את השעות. נסו לבחור את היום מחדש.</p>}
                  {appointmentDate && !slotsLoading && !slotsError && appointmentSlots.length === 0 && <p className="text-sm text-ink/55">אין כרגע שעות פנויות ביום זה.</p>}
                  {appointmentTimeGroups.map((group) => group.slots.length > 0 && <div key={group.label}><p className="mb-1 text-xs font-medium text-ink/55">{group.label}</p><div className="flex flex-wrap gap-2">{group.slots.map((slot) => <button key={slot} type="button" aria-pressed={appointmentTime === slot} onClick={() => { setIdempotencyKey(''); setAppointmentTime(slot); }} className={`min-h-10 min-w-16 rounded-full px-4 py-2 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${appointmentTime === slot ? 'bg-primary/10 text-primary ring-1 ring-primary/25' : 'text-ink hover:bg-primary/5'}`}>{slot}</button>)}</div></div>)}
                </div>
                {appointmentDate && appointmentTime && <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-sm"><p className="font-semibold">סיכום התור</p><p className="mt-1">{reservedAppointmentLines.map(({ p, q }) => `${p.name}${q > 1 ? ` × ${q}` : ''}`).join(', ')}</p><p className="mt-1">{new Intl.DateTimeFormat('he-IL', { dateStyle: 'full', timeZone: 'UTC' }).format(new Date(`${appointmentDate}T12:00:00Z`))} · {appointmentTime}</p><p className="mt-1 text-ink/65">משך: {reservedAppointmentDurationMinutes} דקות · מחיר: {totalText || 'לפי הצעת מחיר'}</p></div>}
              </>
            ) : (
              <p className="text-sm leading-6 text-ink/75">{needsReservedAppointment ? 'לא הוגדרו שעות פעילות שמאפשרות לקבוע תור. פנו לעסק ישירות כדי לתאם.' : `העסק עדיין לא הגדיר שעות פעילות. אפשר לשלוח את הבקשה ללא מועד, והמוכר יתאם איתכם את התור. משך התור הכולל: ${appointmentDurationMinutes} דקות.`}</p>
            )}
          </fieldset>
        )}

        {!done && needsReservedAppointment && appointmentDate && !slotsLoading && !slotsError && appointmentSlots.length === 0 && (
          <div className="mb-4 rounded-xl border border-primary/25 bg-primary/5 p-3">
            <p className="text-sm">אין כרגע שעה פנויה בתאריך שבחרתם. אפשר להשאיר פרטים ברשימת ההמתנה; הבקשה לא שומרת מקום ביומן.</p>
            <button type="button" onClick={() => { setWaitlistOpen(true); setWaitlistError(null); setWaitlistDone(false); }}
              className="mt-2 min-h-10 rounded-full px-4 py-2 text-sm font-medium text-primary underline underline-offset-2 hover:bg-primary/5">
              הצטרפות לרשימת ההמתנה
            </button>
          </div>
        )}

        {waitlistDone && (
          <p role="status" className="mb-4 rounded-xl bg-green-50 p-3 text-sm text-green-900">
            הבקשה נוספה לרשימת ההמתנה. העסק יוכל ליצור איתכם קשר; לא נשמר תור ביומן.
          </p>
        )}

        {waitlistOpen ? (
          <form onSubmit={submitWaitlist} className="mb-4 space-y-3 rounded-xl border border-ink/15 p-3">
            <h3 className="font-semibold">בקשת הצטרפות לרשימת המתנה</h3>
            {waitlistError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{waitlistError}</p>}
            <label className="block text-sm">שם (רשות)
              <input type="text" maxLength={100} autoComplete="name" value={waitlistName} onChange={(e) => setWaitlistName(e.target.value)} className={input} placeholder="שם מלא" />
            </label>
            <label className="block text-sm">טלפון *
              <input required type="tel" inputMode="tel" dir="ltr" value={form.phone} onChange={setField('phone')} className={input} placeholder="0500000000"/>
            </label>
            <label className="block text-sm">תאריך מועדף *
              <input required type="date" min={new Date().toLocaleDateString('en-CA')} value={appointmentDate} onChange={(e) => setAppointmentDate(e.target.value)} className={input}/>
            </label>
            <label className="block text-sm">שעה מועדפת (רשות)
              <input type="time" value={waitlistPreferredTime} onChange={(e) => setWaitlistPreferredTime(e.target.value)} className={input}/>
            </label>
            <label className="block text-sm">הערה (רשות)
              <textarea maxLength={500} rows={3} value={waitlistNote} onChange={(e) => setWaitlistNote(e.target.value)} className={input}/>
            </label>
            <div className="flex gap-2">
              <button type="button" disabled={waitlistBusy} onClick={() => { setWaitlistOpen(false); setWaitlistError(null); }} className="min-h-11 flex-1 rounded-xl border border-ink/20 px-3">ביטול</button>
              <button type="submit" disabled={waitlistBusy} className="min-h-11 flex-1 rounded-xl bg-primary/10 px-3 font-medium text-primary transition hover:bg-primary/10 disabled:opacity-50">
                {waitlistBusy ? 'שולחים…' : 'שליחת בקשת המתנה'}
              </button>
            </div>
          </form>
        ) : null}

        {waitlistOpen ? null : done ? (
          <div className="py-4 text-center">
            <p ref={successRef} tabIndex={-1} role="status" aria-live="polite" aria-atomic="true" className="mb-4 text-lg font-medium focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">
              {done.message}
            </p>
            {done.route === 'whatsapp' && <a href={done.url} onClick={() => dlg.current?.close()} aria-label="פתיחת WhatsApp עם פרטי ההזמנה" className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[#168A52]/10 px-5 py-2 font-medium text-[#168A52] transition hover:bg-[#168A52]/10">שליחת פרטי ההזמנה ב־WhatsApp</a>}
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
                className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#168A52]/10 px-4 py-3 font-medium text-[#168A52] transition hover:bg-[#168A52]/10 disabled:opacity-50">
                {busy === 'whatsapp' ? 'מכין הודעה…' : 'המשך ל־WhatsApp'}
              </button>
            )}
            {calendarOnlySelection && flow.whatsapp_enabled && (
              <div className="space-y-2 rounded-xl border border-primary/25 p-3">
                <p className="text-sm leading-6">אפשר לשמור את התור ביומן בלי לשלוח הודעת WhatsApp. פרטי התור יישמרו גם אם לא תשלחו הודעה לעסק.</p>
                <button type="button" disabled={busy !== null} onClick={() => submit('site')}
                  className="min-h-12 w-full rounded-xl bg-primary/10 px-4 py-3 font-medium text-primary transition hover:bg-primary/10 disabled:opacity-50">
                  {busy === 'site' ? 'שומר את התור…' : 'קביעת תור בלבד – ללא WhatsApp'}
                </button>
              </div>
            )}
            {flow.site_inquiry_enabled && (
              <button type="button" onClick={() => { setError(null); setStep('site'); }}
                className="min-h-12 w-full rounded-xl bg-primary/10 px-4 py-3 font-medium text-primary transition hover:bg-primary/10">
                השארת פנייה באתר
              </button>
            )}
            <p className="text-center text-xs leading-5 text-ink/60">הפריטים שבחרתם יצורפו לפנייה. מעבר ל־WhatsApp לא שולח את ההודעה במקומכם. בקביעת תור בלבד, התור נשמר ביומן גם ללא שליחת הודעה.</p>
          </div>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); submit('site'); }} className="space-y-3">
            {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
            <input type="text" tabIndex={-1} className="hidden" value={form.hp} onChange={setField('hp')} autoComplete="off" />
            {!calendarOnlyFlow && <div>
              <label htmlFor="lead-name" className="block text-sm font-medium">שם (רשות)</label>
              <input id="lead-name" name="name" autoComplete="name" type="text" className={input} value={form.name} onChange={setField('name')} />
            </div>}
            <div>
              <label htmlFor="lead-phone" className="block text-sm font-medium">מספר טלפון *</label>
              <input id="lead-phone" name="tel" autoComplete="tel" dir="ltr" type="tel" required className={input} value={form.phone} onChange={setField('phone')} placeholder="0500000000" />
            </div>
            {!calendarOnlyFlow && <div>
              <label htmlFor="lead-email" className="block text-sm font-medium">אימייל (רשות)</label>
              <input id="lead-email" name="email" autoComplete="email" dir="ltr" type="email" className={input} value={form.email} onChange={setField('email')} />
            </div>}
            <div className="flex gap-2 pt-2">
              {flow.whatsapp_enabled && <button type="button" onClick={() => { setError(null); setStep('choose'); }}
                className="min-h-12 flex-1 rounded-xl px-4 py-3 font-medium text-ink/70 transition hover:bg-ink/5">חזרה</button>}
              <button type="submit" disabled={busy !== null}
                className="min-h-12 flex-1 rounded-xl bg-primary/10 px-4 py-3 font-medium text-primary transition hover:bg-primary/10 disabled:opacity-50">
                {busy === 'site' ? 'שומר…' : calendarOnlyFlow ? 'שמירת התור ביומן' : 'שליחת הפנייה'}
              </button>
            </div>
          </form>
        )}
      </dialog>
    </section>
  );
}