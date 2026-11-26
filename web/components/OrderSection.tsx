'use client';

import StorefrontCatalogItem from '@/components/StorefrontCatalogItem';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ils, normalizeILPhone } from '@/lib/format';
import { getWebPushEnvironment, type WebPushEnvironment } from '@/lib/pushPlatform';
import type { ContactOptions, DayHours, Product, PublicCatalogPage } from '@/lib/types';

type Layout = 'cards' | 'gallery' | 'list' | 'grid' | 'carousel' | 'luxury_catalog';
type Props = { apiBase: string; items: Product[]; quoteLabel: string; contactOptions: ContactOptions; kind: 'product' | 'service'; businessTimezone: string; openingHours: Record<string, DayHours> | null; catalogTotal: number; hasMore: boolean; productLayout: Layout; serviceLayout: Layout };
type Route = 'whatsapp' | 'site' | 'reserve';
type Done = { route: 'site' | 'reserve'; message: string; pushCapabilityToken?: string } | { route: 'whatsapp'; url: string; message: string; pushCapabilityToken?: string };
type Step = 'choose' | 'site' | 'reserve';

type ApiErrorPayload = { issues?: { message: string }[]; error?: string; route?: string; whatsapp_url?: string; success_message?: string; push_capability_token?: string };

function errorText(status: number, d: ApiErrorPayload | null): string {
  if (status === 429) return 'בוצעו יותר מדי ניסיונות. נסו שוב בעוד דקה.';
  if (status === 403) return 'הגדרות העסק השתנו מאז פתיחת האתר. רעננו את הדף ונסו שוב.';
  if (d?.error === 'appointment_required') return 'בחרו תאריך ושעה לשירות שסימנתם.';
  if (d?.error === 'invalid_appointment_time') return 'התאריך או השעה אינם זמינים בשעות הפעילות. בחרו שוב.';
  if (d?.error === 'contact_required') return 'כדי לקבוע תור ביומן, יש להזין מספר טלפון.';
  if (d?.error === 'calendar_booking_disabled' || d?.error === 'route_disabled') return 'מסלול הפנייה הזה אינו פעיל בעסק. רעננו את הדף ונסו שוב.';
  if (d?.error === 'mixed_catalog_types' || d?.error === 'invalid_contact_flow') return 'יש לבחור מוצרים או שירותים בתהליך נפרד.';
  if (d?.error === 'whatsapp_not_configured') return 'מספר ה-WhatsApp של העסק אינו מוגדר כרגע.';
  const msgs: string[] = (d?.issues ?? []).map((i) => i.message);
  if (msgs.includes('invalid_il_phone')) return 'מספר הטלפון אינו תקין.';
  if (msgs.includes('items_or_message_required')) return 'בחרו פריט או כתבו הודעה.';
  if (msgs.includes('contact_required')) return 'נא להזין מספר טלפון תקין.';
  if (msgs.includes('appointment_required')) return 'בחרו תאריך ושעה לשירות שסימנתם.';
  if (msgs.includes('invalid_appointment_time')) return 'התאריך או השעה אינם זמינים בשעות הפעילות. בחרו שוב.';
  if (d?.error === 'unknown_product') return 'אחד הפריטים כבר אינו זמין. רעננו את הדף ונסו שוב.';
  if (d?.error === 'slot_taken' || d?.error === 'slot_blocked') return 'המועד כבר אינו זמין. בחרו מועד פנוי אחר.';
  return 'לא הצלחנו לשלוח. נסו שוב.';
}

function Stepper({ q, onChange, label, canRemove }: { q: number; onChange: (n: number) => void; label: string; canRemove: boolean }) {
  const btn = 'h-9 w-9 rounded-full border-0 text-lg leading-none flex items-center justify-center text-primary transition hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-40';
  return (
    <div className="flex items-center gap-1" role="group" aria-label={label}>
      <button type="button" disabled={q <= 1 && !canRemove} className={btn} aria-label="הפחתת כמות" onClick={() => onChange(q - 1)}>−</button>
      <span className="w-8 text-center font-semibold" aria-live="polite">{q}</span>
      <button type="button" className={btn} aria-label="הוספת כמות" onClick={() => onChange(q + 1)}>+</button>
    </div>
  );
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number, onTimeout?: () => void): Promise<T> {
  let timer: number;
  const timeout = new Promise<T>((_, reject) => {
    timer = window.setTimeout(() => {
      onTimeout?.();
      reject(new Error('push_timeout'));
    }, milliseconds);
  });
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timer));
}

function dateInTimezone(timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export default function OrderSection({ apiBase, items: initialItems, quoteLabel, contactOptions, kind, businessTimezone, openingHours, catalogTotal, hasMore: initiallyHasMore, productLayout, serviceLayout }: Props) {
  const dlg = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const sectionHeadingRef = useRef<HTMLHeadingElement>(null);
  const successRef = useRef<HTMLParagraphElement>(null);
  const [items, setItems] = useState<Product[]>(initialItems.filter((item) => item.kind === kind));
  const [nextOffset, setNextOffset] = useState(initialItems.filter((item) => item.kind === kind).length);
  const [hasMore, setHasMore] = useState(initiallyHasMore);
  const [loadingMore, setLoadingMore] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [searchTotal, setSearchTotal] = useState(catalogTotal);
  const [searching, setSearching] = useState(false);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [otherCartCount, setOtherCartCount] = useState(0);
  // Keep selected item snapshots independent of the visible/search-filtered catalog page.
  const [selectedProducts, setSelectedProducts] = useState<Record<string, Product>>({});
  const [form, setForm] = useState({ name: '', phone: '', email: '', hp: '' });
  const [appointmentDate, setAppointmentDate] = useState('');
  const [appointmentMonth, setAppointmentMonth] = useState(() => dateInTimezone(businessTimezone).slice(0, 7));
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
  const [waitlistPushCapability, setWaitlistPushCapability] = useState<string | null>(null);
  const [pushPublicKey, setPushPublicKey] = useState<string | null>(null);
  const [pushEnvironment, setPushEnvironment] = useState<WebPushEnvironment | 'checking'>('checking');
  const [customerPushActive, setCustomerPushActive] = useState(false);
  const [customerPushManageStatus, setCustomerPushManageStatus] = useState<string | null>(null);
  const [appointmentPushState, setAppointmentPushState] = useState({ busy: false, success: false, status: null as string | null });
  const [waitlistPushState, setWaitlistPushState] = useState({ busy: false, success: false, status: null as string | null });
  const [pushRevoked, setPushRevoked] = useState({ appointment: false, waitlist: false });
  const pushAttemptRef = useRef({ appointment: 0, waitlist: 0 });
  const pushAbortRef = useRef<{ appointment: AbortController | null; waitlist: AbortController | null }>({ appointment: null, waitlist: null });
  const [waitlistBusy, setWaitlistBusy] = useState(false);
  const [waitlistError, setWaitlistError] = useState<string | null>(null);
  const [waitlistName, setWaitlistName] = useState('');
  const [waitlistPreferredDate, setWaitlistPreferredDate] = useState('');
  const [waitlistPreferredTime, setWaitlistPreferredTime] = useState('');
  const [waitlistNote, setWaitlistNote] = useState('');
  const contactSettings = kind === 'product' ? contactOptions.products : contactOptions.services;
  const whatsappEnabled = contactSettings.whatsapp_enabled;
  const crmEnabled = contactSettings.crm_enabled;
  const calendarEnabled = kind === 'service' && contactOptions.services.calendar_enabled;

  useEffect(() => {
    if (done) successRef.current?.focus();
  }, [done]);

  useEffect(() => {
    setPushEnvironment(getWebPushEnvironment());
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(`${apiBase}/push/config`, { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : null)
      .then((config: { enabled?: boolean; public_key?: string | null } | null) => {
        if (!cancelled && config?.enabled && config.public_key) setPushPublicKey(config.public_key);
      })
      .catch(() => { if (!cancelled) setPushPublicKey(null); });
    return () => { cancelled = true; };
  }, [apiBase]);



  useEffect(() => {
    setAppointmentPushState({ busy: false, success: false, status: null });
    setPushRevoked((current) => ({ ...current, appointment: false }));
  }, [done?.pushCapabilityToken]);

  useEffect(() => {
    setWaitlistPushState({ busy: false, success: false, status: null });
    setPushRevoked((current) => ({ ...current, waitlist: false }));
  }, [waitlistPushCapability]);

  useEffect(() => {
    let cancelled = false;
    if (pushEnvironment !== 'supported' || !pushPublicKey || typeof Notification === 'undefined' || Notification.permission !== 'granted' ||
        !('serviceWorker' in navigator) || !('PushManager' in window)) return;
    void (async () => {
      try {
        const registration = await withTimeout(navigator.serviceWorker.ready, 10000);
        const subscription = await withTimeout(registration.pushManager.getSubscription(), 10000);
        if (!subscription) return;
        const response = await fetch(`${apiBase}/push/subscriptions/customer/status`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        const status = await response.json().catch(() => null) as { active?: boolean } | null;
        if (!cancelled && response.ok) setCustomerPushActive(status?.active === true);
      } catch {
        if (!cancelled) setCustomerPushActive(false);
      }
    })();
    return () => { cancelled = true; };
  }, [apiBase, pushPublicKey, pushEnvironment]);

  async function cancelCustomerPush() {
    setCustomerPushManageStatus(null);
    try {
      if (!('serviceWorker' in navigator)) throw new Error('push_not_supported');
      const registration = await withTimeout(navigator.serviceWorker.ready, 10000);
      const subscription = await withTimeout(registration.pushManager.getSubscription(), 10000);
      if (!subscription) throw new Error('push_subscription_missing');
      const response = await fetch(`${apiBase}/push/subscriptions/customer`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
      if (!response.ok) throw new Error('push_revoke_failed');
      setCustomerPushActive(false);
      setPushRevoked({ appointment: true, waitlist: true });
      setCustomerPushManageStatus('ההתראות בוטלו לעסק הזה בלבד.');
    } catch {
      setCustomerPushManageStatus('לא הצלחנו לבטל את ההתראות כרגע. נסו שוב.');
    }
  }

  async function optInForPush(capabilityToken: string, target: 'appointment' | 'waitlist', explicitConsent = true) {
    if (!pushPublicKey || pushEnvironment !== 'supported') return;
    const currentState = target === 'appointment' ? appointmentPushState : waitlistPushState;
    if (currentState.busy || pushAbortRef.current[target]) return;
    const attempt = ++pushAttemptRef.current[target];
    const isCurrent = () => pushAttemptRef.current[target] === attempt;
    const setTargetState = target === 'appointment' ? setAppointmentPushState : setWaitlistPushState;
    setTargetState({ busy: true, success: false, status: null });
    let timeoutId: number | undefined;
    let pushStage: 'permission' | 'service_worker' | 'subscription' | 'consent' = 'permission';
    const controller = new AbortController();
    pushAbortRef.current[target] = controller;
    try {
      if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
        throw new Error('push_not_supported');
      }
      if (Notification.permission === 'denied') throw new Error('push_permission_blocked');
      if (!explicitConsent && Notification.permission !== 'granted') return;
      const permission = Notification.permission === 'granted'
        ? 'granted'
        : await withTimeout(Notification.requestPermission(), 45000);
      if (!isCurrent()) return;
      if (permission !== 'granted') throw new Error('push_permission_denied');

      pushStage = 'service_worker';
      await withTimeout(navigator.serviceWorker.register('/sw.js'), 15000);
      if (!isCurrent()) return;
      // register() may return while the worker is still installing. PushManager
      // operations must use an active registration, especially on first visit.
      const registration = await withTimeout(navigator.serviceWorker.ready, 15000);
      if (!isCurrent()) return;
      if (!registration.active) throw new Error('push_service_worker_inactive');
      pushStage = 'subscription';
      let subscription = await withTimeout(registration.pushManager.getSubscription(), 10000);
      if (!isCurrent()) return;
      if (!subscription) {
        const padding = '='.repeat((4 - (pushPublicKey.length % 4)) % 4);
        const raw = atob(pushPublicKey.replace(/-/g, '+').replace(/_/g, '/') + padding);
        const applicationServerKey = Uint8Array.from(raw, (char) => char.charCodeAt(0));
        subscription = await withTimeout(registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey.buffer as ArrayBuffer,
        }), 20000);
      }
      if (!isCurrent()) return;
      const json = subscription.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new Error('push_subscription_invalid');

      pushStage = 'consent';
      timeoutId = window.setTimeout(() => controller.abort(), 15000);
      const response = await fetch(`${apiBase}/push/consent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          token: capabilityToken,
          explicit_consent: explicitConsent,
          subscription: { endpoint: json.endpoint, keys: json.keys },
        }),
        signal: controller.signal,
      });
      if (!isCurrent()) return;
      const data = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!response.ok || data?.ok !== true) {
        throw new Error(data?.error ?? 'push_consent_failed');
      }
      setPushRevoked((current) => ({ ...current, [target]: false }));
      setCustomerPushActive(true);
      setCustomerPushManageStatus(null);
      setTargetState({ busy: false, success: true, status: 'ההתראות הופעלו לעסק הזה. תקבלו עדכונים רק על התורים ובקשות ההמתנה שלכם.' });
    } catch (error) {
      if (!isCurrent()) return;
      const code = error instanceof Error ? error.message : '';
      const aborted = error instanceof DOMException && error.name === 'AbortError';
      setTargetState({
        busy: false,
        success: false,
        status: code === 'push_permission_blocked' || code === 'push_permission_denied'
          ? 'כדי להפעיל התראות, אשרו אותן בהגדרות הדפדפן וחזרו לכאן.'
          : code === 'push_not_supported'
            ? 'הדפדפן אינו תומך בהתראות במצב הנוכחי.'
            : code === 'customer_push_disabled' || code === 'push_not_available'
              ? 'ההתראות אינן זמינות כרגע בעסק הזה.'
              : code === 'push_consent_expired'
                ? 'תוקף בקשת ההרשמה להתראות הסתיים. רעננו את הדף ונסו שוב.'
                : code === 'push_consent_already_used'
                  ? 'בקשת ההתראות הזו כבר קושרה למכשיר אחר.'
                  : code === 'push_not_configured'
                    ? 'שירות ההתראות עדיין לא הוגדר בעסק.'
                    : code === 'push_timeout'
                      ? pushStage === 'service_worker'
                        ? 'רכיב ההתראות עדיין נטען. המתינו רגע ונסו שוב.'
                        : pushStage === 'subscription'
                          ? 'הדפדפן מתעכב ביצירת הרשמת ההתראות. אפשר לנסות שוב.'
                          : pushStage === 'consent'
                            ? 'שמירת ההסכמה בשרת התעכבה. אפשר לנסות שוב.'
                            : 'בקשת ההרשאה לא הושלמה. אפשר לנסות שוב.'
                      : aborted || code === 'AbortError'
                        ? 'שמירת ההסכמה בשרת התעכבה. אפשר לנסות שוב.'
                      : code === 'push_service_worker_inactive'
                        ? 'רכיב ההתראות עדיין נטען. המתינו רגע ונסו שוב.'
                        : 'לא הצלחנו להפעיל התראות כרגע. אפשר לנסות שוב.',
      });
    } finally {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      if (pushAbortRef.current[target] === controller) pushAbortRef.current[target] = null;
      if (isCurrent()) setTargetState((current) => ({ ...current, busy: false }));
    }
  }

  async function cancelPushForBusiness(target: 'appointment' | 'waitlist') {
    const setTargetState = target === 'appointment' ? setAppointmentPushState : setWaitlistPushState;
    setTargetState({ busy: true, success: false, status: null });
    try {
      if (!('serviceWorker' in navigator)) throw new Error('push_not_supported');
      const registration = await withTimeout(navigator.serviceWorker.ready, 10000);
      const subscription = await withTimeout(registration.pushManager.getSubscription(), 10000);
      if (!subscription) throw new Error('push_subscription_missing');
      const response = await fetch(`${apiBase}/push/subscriptions/customer`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
      if (!response.ok) throw new Error('push_revoke_failed');
      setPushRevoked((current) => ({ ...current, [target]: true }));
      setCustomerPushActive(false);
      setCustomerPushManageStatus('ההתראות בוטלו לעסק הזה בלבד.');
      setTargetState({ busy: false, success: false, status: 'ההתראות בוטלו לעסק הזה. לא יישלחו עוד עדכונים למכשיר הזה מהעסק.' });
    } catch {
      setTargetState((current) => ({ ...current, busy: false, status: 'לא הצלחנו לבטל את ההתראות כרגע. נסו שוב.' }));
    }
  }

  async function autoLinkExistingPush(capabilityToken: string, target: 'appointment' | 'waitlist') {
    if (pushEnvironment !== 'supported' || typeof Notification === 'undefined' || Notification.permission !== 'granted' ||
        !('serviceWorker' in navigator) || !('PushManager' in window)) return;
    try {
      const registration = await withTimeout(navigator.serviceWorker.ready, 10000);
      const subscription = await withTimeout(registration.pushManager.getSubscription(), 10000);
      if (!subscription) return;
      const statusResponse = await fetch(`${apiBase}/push/subscriptions/customer/status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
      const status = await statusResponse.json().catch(() => null) as { active?: boolean } | null;
      if (statusResponse.ok && status?.active) {
        await optInForPush(capabilityToken, target, false);
      }
    } catch {
      // A failed background link must never block the booking or show a new permission prompt.
    }
  }

  useEffect(() => {
    const token = done?.pushCapabilityToken;
    if (!token || !pushPublicKey) return;
    void autoLinkExistingPush(token, 'appointment');
  }, [done?.pushCapabilityToken, pushPublicKey, apiBase, pushEnvironment]);

  useEffect(() => {
    if (!waitlistPushCapability || !waitlistDone || !pushPublicKey) return;
    void autoLinkExistingPush(waitlistPushCapability, 'waitlist');
  }, [waitlistPushCapability, waitlistDone, pushPublicKey, apiBase, pushEnvironment]);

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
    const params = new URLSearchParams({ kind, search: term, limit: '12', offset: '0' });
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
  }, [apiBase, search, initialItems, initiallyHasMore, catalogTotal, kind]);

  async function loadMore() {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true); setCatalogError(null);
    try {
      const params = new URLSearchParams({ kind, limit: '12', offset: String(nextOffset) });
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
    .map(([id, q]) => ({ p: selectedProducts[id] ?? byId.get(id), q }))
    .filter((line): line is { p: Product; q: number } => Boolean(line.p));
  const count = lines.reduce((s, l) => s + l.q, 0);
  useEffect(() => {
    const onCartChange = (event: Event) => {
      const detail = (event as CustomEvent<{ kind: 'product' | 'service'; count: number }>).detail;
      if (detail && detail.kind !== kind) setOtherCartCount(Math.max(0, detail.count));
    };
    window.addEventListener('btime:storefront-cart-change', onCartChange);
    return () => window.removeEventListener('btime:storefront-cart-change', onCartChange);
  }, [kind]);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('btime:storefront-cart-change', { detail: { kind, count } }));
  }, [kind, count]);
  useEffect(() => () => {
    window.dispatchEvent(new CustomEvent('btime:storefront-cart-change', { detail: { kind, count: 0 } }));
  }, [kind]);
  const stackedOrderBar = kind === 'service' && otherCartCount > 0;
  const appointmentLines = kind === 'service' ? lines : [];
  const needsAppointment = calendarEnabled && appointmentLines.length > 0;
  const reservedAppointmentLines = appointmentLines;
  const reservedAppointmentDurationMinutes = appointmentLines.reduce((sum, { p, q }) => sum + p.appointment_duration_minutes * q, 0);
  const canOrder = kind === 'product' ? (whatsappEnabled || crmEnabled) : (whatsappEnabled || calendarEnabled);
  const cartSignature = useMemo(() => Object.entries(cart).sort(([a], [b]) => a.localeCompare(b)).map(([id, quantity]) => `${id}:${quantity}`).join(','), [cart]);
  const hasAppointmentHours = useMemo(
    () => Object.values(openingHours ?? {}).some((ranges) => Array.isArray(ranges) && ranges.length > 0),
    [openingHours],
  );
  useEffect(() => {
    if (!needsAppointment || step !== 'reserve' || !cartSignature || !hasAppointmentHours) {
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
  }, [apiBase, appointmentMonth, cartSignature, hasAppointmentHours, needsAppointment, step]);
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
  const todayDate = dateInTimezone(businessTimezone);
  const appointmentSlots = serverAppointmentSlots;
  const appointmentTimeGroups = [
    { label: 'בוקר', slots: appointmentSlots.filter((slot) => Number(slot.slice(0, 2)) < 12) },
    { label: 'צהריים', slots: appointmentSlots.filter((slot) => Number(slot.slice(0, 2)) >= 12 && Number(slot.slice(0, 2)) < 17) },
    { label: 'ערב', slots: appointmentSlots.filter((slot) => Number(slot.slice(0, 2)) >= 17) },
  ];
  useEffect(() => {
    if (!needsAppointment || step !== 'reserve' || !appointmentDate || !cartSignature) {
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
  }, [apiBase, appointmentDate, cartSignature, needsAppointment, step]);
  // All selected services share one duration and reserve one calendar block.
  const priced = lines.filter((l) => l.p.price_agorot !== null);
  const total = priced.reduce((s, l) => s + l.p.price_agorot! * l.q, 0);
  const hasQuote = lines.some((l) => l.p.price_agorot === null);
  const totalText = priced.length === 0 ? (hasQuote ? quoteLabel : '')
    : hasQuote ? `${ils(total)} + ${quoteLabel}` : ils(total);

  const setQty = (product: Product, q: number) => {
    // Keep at least one distinct item in the order so the quantity control
    // cannot accidentally empty the flow.
    if (q <= 0 && Object.keys(cart).length <= 1) return;
    const id = product.id;
    setIdempotencyKey('');
    setAppointmentTime('');
    setCart((current) => {
      const next = { ...current };
      if (q <= 0) delete next[id]; else next[id] = Math.min(99, q);
      return next;
    });
    setSelectedProducts((current) => {
      const next = { ...current };
      if (q <= 0) delete next[id]; else next[id] = product;
      return next;
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
    if (count === 0) return setError(kind === 'product' ? 'יש לבחור לפחות מוצר אחד.' : 'יש לבחור לפחות שירות אחד.');
    if (route === 'reserve' && !hasAppointmentHours) return setError('לא הוגדרו שעות פעילות שמאפשרות לקבוע תור. אפשר להצטרף לרשימת המתנה.');
    if (route === 'reserve' && (!appointmentDate || !appointmentTime)) return setError('בחרו תאריך ושעה לשירות.');
    if ((route === 'site' || route === 'reserve') && !phone) return setError('נא להזין מספר טלפון ישראלי תקין.');

    setBusy(route);
    try {
      const requestKey = idempotencyKey || crypto.randomUUID();
      if (!idempotencyKey) setIdempotencyKey(requestKey);
      const submitController = new AbortController();
      const res = await withTimeout(fetch(`${apiBase}/leads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          route,
          idempotency_key: requestKey,
          ...(form.name.trim() ? { customer_name: form.name.trim() } : {}),
          ...(phone ? { customer_phone: phone } : {}),
          ...(route === 'site' && form.email.trim() ? { customer_email: form.email.trim() } : {}),
          ...(route === 'reserve' && appointmentDate && appointmentTime ? { appointment_at: `${appointmentDate}T${appointmentTime}` } : {}),
          items: Object.entries(cart).map(([product_id, quantity]) => ({ product_id, quantity })),
          company_website: form.hp,
        }),
        signal: submitController.signal,
      }), 30000, () => submitController.abort());
      const data = await res.json().catch(() => null) as ApiErrorPayload | null;
      if (!res.ok) return setError(errorText(res.status, data));

      // The server has confirmed persistence. Clear the order immediately so
      // returning from WhatsApp cannot accidentally submit the same cart again.
      setIdempotencyKey('');
      setCart({});
      setAppointmentDate('');
      setAppointmentTime('');
      setServerAppointmentSlots([]);
      if (route === 'whatsapp') {
        if (!data?.whatsapp_url) return setError('לא הצלחנו להכין קישור WhatsApp. נסו שוב.');
        setDone({ route: 'whatsapp', url: data.whatsapp_url, message: data.success_message ?? 'הפנייה נשמרה. יש לשלוח את ההודעה כדי להשלים את הפנייה.', pushCapabilityToken: data.push_capability_token });
      } else {
        setDone({ route, message: data?.success_message ?? (route === 'reserve' ? 'התור נשמר ביומן.' : 'הפנייה נשלחה בהצלחה.'), pushCapabilityToken: data?.push_capability_token });
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
    if (!waitlistPreferredDate) return setWaitlistError('בחרו תאריך מועדף.');
    const phone = normalizeILPhone(form.phone);
    if (!phone) return setWaitlistError('נא להזין מספר טלפון ישראלי תקין.');
    setWaitlistBusy(true);
    try {
      const waitlistController = new AbortController();
      const response = await withTimeout(fetch(`${apiBase}/waitlist`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          customer_name: waitlistName.trim() || undefined,
          customer_phone: phone,
          service_ids: lines.map(({ p }) => p.id),
          preferred_date: waitlistPreferredDate,
          ...(waitlistPreferredTime ? { preferred_time: waitlistPreferredTime } : {}),
          note: waitlistNote.trim(),
          company_website: '',
        }),
        signal: waitlistController.signal,
      }), 30000, () => waitlistController.abort());
      const data = await response.json().catch(() => null) as { error?: string; push_capability_token?: string } | null;
      if (!response.ok) {
        if (response.status === 409 || data?.error === 'duplicate_waitlist_request') {
          setWaitlistError('כבר קיימת בקשת המתנה פעילה עם אותם פרטים.');
        } else if (data?.error === 'preferred_date_in_past') {
          setWaitlistError('התאריך שנבחר כבר עבר. בחרו תאריך אחר.');
        } else if (data?.error === 'invalid_waitlist_services' || data?.error === 'calendar_booking_disabled') {
          setWaitlistError('לא ניתן להצטרף כרגע לרשימת ההמתנה לשירותים שנבחרו. רעננו את הדף ונסו שוב.');
        } else if (response.status === 429) {
          setWaitlistError('נשלחו יותר מדי בקשות. נסו שוב מאוחר יותר.');
        } else {
          setWaitlistError('לא הצלחנו להצטרף לרשימת ההמתנה. בדקו את הפרטים ונסו שוב.');
        }
        return;
      }
      setWaitlistPushCapability(data?.push_capability_token ?? null);
      setWaitlistDone(true);
      setWaitlistOpen(false);
      setCart({});
      setSelectedProducts({});
      setIdempotencyKey('');
      setAppointmentDate('');
      setAppointmentTime('');
    } catch {
      setWaitlistError('שגיאת רשת. נסו שוב.');
    } finally {
      setWaitlistBusy(false);
    }
  }

  const input = 'mt-1 min-h-11 min-w-0 max-w-full w-full rounded-xl border border-ink/25 bg-surface px-3 py-2 text-start';
  const openWaitlist = () => {
    setWaitlistPreferredDate(appointmentDate);
    setWaitlistPreferredTime(appointmentTime);
    setWaitlistOpen(true);
    setWaitlistError(null);
    setWaitlistDone(false);
    setWaitlistPushCapability(null);
    setWaitlistPushState({ busy: false, success: false, status: null });
  };

  const openContinuation = () => {
    setError(null);
    setDone(null);
    setWaitlistDone(false);
    setWaitlistError(null);
    setWaitlistPushCapability(null);
    setStep(kind === 'product' && crmEnabled && !whatsappEnabled ? 'site' : 'choose');
    dlg.current?.showModal();
  };

  return (
    <section aria-labelledby={kind === 'product' ? 'products-h' : 'services-h'} className={count ? (otherCartCount > 0 ? 'pb-40' : 'pb-24') : ''}>
      <div className="flex items-center justify-between gap-3">
        <h2 ref={sectionHeadingRef} id={kind === 'product' ? 'products-h' : 'services-h'} tabIndex={-1} className="text-2xl font-bold">{kind === 'product' ? 'המוצרים שלנו' : 'השירותים שלנו'}</h2>
      </div>
      {(items.length > 0 || search.trim()) && <p className="mt-1 text-sm leading-5 text-ink/65">{kind === 'product' ? 'בחרו מוצר כדי להוסיף אותו להזמנה.' : 'בחרו שירות כדי להוסיף אותו להזמנה.'}</p>}

      {catalogTotal >= 5 && (
        <div className="mt-4">
          <label htmlFor={`storefront-${kind}-search`} className="sr-only">חיפוש {kind === 'product' ? 'חיפוש מוצרים' : 'חיפוש שירותים'}</label>
          <input id={`storefront-${kind}-search`} type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="חיפוש לפי שם או תיאור…" className="min-h-11 w-full rounded-xl border border-ink/20 bg-white px-4 py-2 text-start focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" />
        </div>
      )}
      {searching && <p role="status" className="mt-3 text-sm text-ink/65">מחפשים פריטים…</p>}
      {!searching && search.trim() && items.length === 0 && !catalogError && <p className="mt-4 text-sm text-ink/65">לא נמצאו פריטים התואמים לחיפוש.</p>}

      {items.length > 0 && (
        <div className="mt-3 space-y-5">
          {(['product', 'service'] as const).map((kind) => {
            const groupItems = items.filter((item) => item.kind === kind);
            if (!groupItems.length) return null;
            const layout = kind === 'product' ? productLayout : serviceLayout;
            return <section key={kind} id={kind === 'service' ? 'services-subsection' : 'products-subsection'} data-profile-section={kind} aria-label={kind === 'product' ? 'מוצרים' : 'שירותים'}>
              {items.some((item) => item.kind === 'product') && items.some((item) => item.kind === 'service') && <h3 className="mb-2 text-lg font-bold">{kind === 'product' ? 'מוצרים' : 'שירותים'}</h3>}
              <ul data-storefront-list data-kind={kind} data-layout={layout} className="storefront-items-list">
          {groupItems.map((p) => (
            <StorefrontCatalogItem
              key={p.id}
              product={p}
              quoteLabel={quoteLabel}
              action={{
                type: 'catalog',
                quantity: cart[p.id] ?? 0,
                 canOrder,
                 canRemove: Object.keys(cart).length > 1,
                 onQuantityChange: (quantity) => setQty(p, quantity),
              }}
            />
          ))}
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
        <div
          data-stacked={stackedOrderBar ? 'true' : 'false'}
          className={`storefront-order-bar fixed inset-x-0 z-40 flex items-center justify-between gap-4 border-t border-ink/10 bg-surface/95 p-3 shadow-sm backdrop-blur-sm sm:p-4 ${stackedOrderBar ? 'bottom-[4.3125rem] sm:bottom-[4.8125rem]' : 'bottom-0'}`}
        >
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => { setCart({}); setStep('choose'); setError(null); }}
              aria-label={kind === 'product' ? 'ביטול בחירת המוצרים וניקוי ההזמנה' : 'ביטול בחירת השירותים וניקוי ההזמנה'}
              title={kind === 'product' ? 'ניקוי בחירת המוצרים' : 'ניקוי בחירת השירותים'}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xl text-ink/65 transition hover:bg-ink/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <span aria-hidden="true">×</span>
            </button>
            <div className="min-w-0">
              <div className="text-xs text-ink/70">{count} {kind === 'product' ? 'מוצרים' : 'שירותים'} נבחרו</div>
              <div className="font-bold text-lg">{totalText}</div>
            </div>
          </div>
          <button ref={openerRef} type="button" onClick={openContinuation}
            className="min-h-11 shrink-0 rounded-full border-0 bg-primary/10 px-4 py-2.5 text-sm font-medium text-primary transition hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:px-6">
            {kind === 'product' ? 'המשך לפנייה' : 'בחירת דרך תיאום'}
          </button>
        </div>
      )}

      {/* Order Modal */}
      <dialog ref={dlg} aria-labelledby={`order-dialog-title-${kind}`} onClose={() => (openerRef.current ?? sectionHeadingRef.current)?.focus()} className="customer-order-dialog m-auto box-border max-h-[calc(100dvh-1rem)] w-[calc(100%-1.5rem)] max-w-[30rem] min-w-0 overflow-x-hidden overflow-y-auto overscroll-contain rounded-2xl bg-surface p-3 text-start shadow-xl backdrop:bg-black/50 sm:max-h-[calc(100dvh-2rem)] sm:p-6">
        <div className="mb-4 flex min-w-0 items-center justify-between gap-2">
          <h3 id={`order-dialog-title-${kind}`} className="min-w-0 text-xl font-bold">{kind === 'product' ? 'המשך לפנייה' : 'בחירת דרך תיאום'}</h3>
          <button type="button" onClick={() => dlg.current?.close()} aria-label={done ? "סגירת הודעת האישור; התור נשאר שמור" : "סגירת חלון ההזמנה"} className="min-h-11 min-w-11 rounded-lg border border-ink/20 p-2 text-xl focus-visible:outline-2 focus-visible:outline-offset-2">✕</button>
        </div>

        {!done && !waitlistDone && (
          <div className="mb-4 rounded-xl bg-gray-50 p-3">
            <ul className="space-y-1.5 text-sm">
              {lines.map(({ p, q }) => {
                const durationLabel = p.kind === 'service' ? 'משך השירות' : '';
                return <li key={`${p.kind}:${p.id}`} data-cart-item-id={p.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-b border-gray-200 pb-3 last:border-b-0 last:pb-0">
                  <span className="min-w-0 break-words font-medium">{p.name} × {q}{durationLabel ? <span className="block text-xs font-normal text-ink/60">{durationLabel}: {p.appointment_duration_minutes * q} דקות</span> : null}</span>
                  <span className="shrink-0 text-end font-medium">{p.price_agorot === null ? quoteLabel : ils(p.price_agorot * q)}</span>
                  {!done && (
                    <div className="col-span-2 flex min-w-0 items-center justify-between gap-3 border-t border-gray-200 pt-2">
                      <Stepper q={q} label={`כמות: ${p.name}`} canRemove={lines.length > 1} onChange={(next) => setQty(p, next)} />
                       {lines.length > 1 && <button type="button" onClick={() => setQty(p, 0)} className="min-h-9 rounded-lg px-3 text-sm font-medium text-red-700 underline underline-offset-2">הסרת הפריט</button>}
                    </div>
                  )}
                </li>;
              })}
            </ul>
            {totalText && <div className="mt-3 flex justify-between border-t border-gray-200 pt-2 font-bold"><span>סכום משוער</span><span>{totalText}</span></div>}
          </div>
        )}

        {!done && !waitlistOpen && !waitlistDone && step === 'reserve' && needsAppointment && (
          <fieldset className="mb-4 space-y-3 rounded-xl border border-ink/15 p-3">
            <legend className="px-1 text-sm font-semibold">תיאום תור</legend>
            {hasAppointmentHours ? (
              <>
                <p className="text-xs leading-5 text-ink/65">{`משך התור ביומן לכל השירותים שנבחרו: ${reservedAppointmentDurationMinutes} דקות. בחרו שעה פנויה; התור יישמר ביומן לאחר אישור הבקשה.`}</p>
                <div className="space-y-3">
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-semibold">בחירת תאריך</span>
                    <div className="flex min-w-0 items-center gap-1">
                      <button type="button" onClick={() => moveAppointmentMonth(-1)} disabled={appointmentMonth <= todayDate.slice(0, 7)} aria-label="חודש קודם" className="grid h-8 w-8 shrink-0 place-items-center rounded-full disabled:cursor-not-allowed disabled:opacity-30">‹</button>
                      <span aria-live="polite" className="min-w-0 text-center text-sm font-semibold capitalize">{appointmentMonthLabel}</span>
                      <button type="button" onClick={() => moveAppointmentMonth(1)} aria-label="חודש הבא" className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-ink/20">›</button>
                      <button type="button" onClick={() => { const month = todayDate.slice(0, 7); setAppointmentMonth(month); if (appointmentDate.slice(0, 7) !== month) { setAppointmentDate(''); setAppointmentTime(''); setIdempotencyKey(''); } }} className="shrink-0 rounded-full px-2 py-2 text-xs font-medium text-primary underline underline-offset-2">החודש</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-7 gap-1 text-center text-xs text-ink/55">{['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'].map((day) => <span key={day} className="py-1">{day}</span>)}</div>
                  <div role="group" aria-label="בחירת יום בחודש" className="grid min-w-0 grid-cols-7 gap-1">
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
                  {appointmentTimeGroups.map((group) => group.slots.length > 0 && <div key={group.label}><p className="mb-1 text-xs font-medium text-ink/55">{group.label}</p><div className="flex flex-wrap gap-2">{group.slots.map((slot) => <button key={slot} type="button" aria-pressed={appointmentTime === slot} onClick={() => { setIdempotencyKey(''); setAppointmentTime((current) => current === slot ? '' : slot); }} className={`min-h-10 min-w-16 rounded-full px-4 py-2 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${appointmentTime === slot ? 'bg-primary/10 text-primary ring-1 ring-primary/25' : 'text-ink hover:bg-primary/5'}`}>{slot}</button>)}</div></div>)}
                </div>
                {appointmentDate && appointmentTime && <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-sm"><p className="font-semibold">סיכום התור</p><p className="mt-1">{reservedAppointmentLines.map(({ p, q }) => `${p.name}${q > 1 ? ` × ${q}` : ''}`).join(', ')}</p><p className="mt-1">{new Intl.DateTimeFormat('he-IL', { dateStyle: 'full', timeZone: 'UTC' }).format(new Date(`${appointmentDate}T12:00:00Z`))} · {appointmentTime}</p><p className="mt-1 text-ink/65">משך: {reservedAppointmentDurationMinutes} דקות · מחיר: {totalText || 'לפי הצעת מחיר'}</p></div>}
                {!appointmentTime && !monthLoading && !monthError && !slotsLoading && !slotsError && (
                  <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
                    <p className="text-sm font-semibold">לא מצאתם מועד שמתאים לכם?</p>
                    <p className="mt-1 text-xs leading-5 text-ink/65">אפשר להשאיר בקשת המתנה עם תאריך ושעה מועדפים. העסק יוכל לבדוק את האפשרות וליצור איתכם קשר; הבקשה אינה שומרת תור ביומן.</p>
                    <button type="button" onClick={openWaitlist} className="mt-2 min-h-11 w-full rounded-xl border border-primary/30 bg-surface px-4 py-2 text-sm font-semibold text-primary">
                      בקשת הצטרפות לרשימת המתנה
                    </button>
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm leading-6 text-ink/75">לא הוגדרו שעות פעילות שמאפשרות לקבוע תור. אפשר לבחור בקשת המתנה או לפנות לעסק ב-WhatsApp.</p>
            )}
          </fieldset>
        )}


        {waitlistDone && (
          <div role="status" className="mb-4 rounded-xl bg-green-50 p-3 text-sm text-green-900">
            <p>הבקשה נוספה לרשימת ההמתנה. העסק יוכל ליצור איתכם קשר; לא נשמר תור ביומן.</p>
            {waitlistPushCapability && pushPublicKey && (
              <div className="mt-3">
                {pushRevoked.waitlist ? (
                  <div>
                    <p role="status" className="text-sm">{waitlistPushState.status ?? 'ההתראות בוטלו לעסק הזה.'}</p>
                    <button type="button" disabled={waitlistPushState.busy} onClick={() => void optInForPush(waitlistPushCapability, 'waitlist', true)}
                      className="mt-2 text-xs underline disabled:opacity-50">הפעלת התראות מחדש</button>
                  </div>
                ) : waitlistPushState.success ? (
                  <div>
                    <p role="status" className="text-sm">ההתראות הופעלו לעסק הזה. תקבלו עדכונים רק על התורים ובקשות ההמתנה שלכם.</p>
                    <button type="button" disabled={waitlistPushState.busy} onClick={() => void cancelPushForBusiness('waitlist')}
                      className="mt-2 text-xs underline disabled:opacity-50">{waitlistPushState.busy ? 'מבטלים…' : 'ביטול התראות מהעסק הזה'}</button>
                  </div>
                ) : pushEnvironment === 'ios-home-screen-required' ? (
                  <p className="text-sm leading-6 text-green-900">ב-iPhone או iPad, Push זמין רק באתר שהותקן למסך הבית (iOS/iPadOS 16.4 ומעלה). כדי לקבל התראות על הזמנה חדשה, פתחו ב-Safari, לחצו על שיתוף ואז „הוספה למסך הבית”; לאחר מכן פתחו את האתר מהסמל החדש ובצעו ממנו את ההזמנה. הזמנה שכבר בוצעה בטאב Safari אינה מקושרת אוטומטית לאפליקציה שהותקנה.</p>
                ) : pushEnvironment === 'checking' ? (
                  <p className="text-sm text-green-900">בודקים תמיכה בהתראות במכשיר…</p>
                ) : pushEnvironment === 'unsupported' ? (
                  <p className="text-sm text-green-900">הדפדפן או מצב הגלישה הנוכחי אינם תומכים בהתראות Push.</p>
                ) : (
                  <>
                    <p className="font-semibold text-green-950">לקבל עדכונים על התורים שלכם בעסק הזה?</p>
                    <p className="mt-1 text-xs leading-5 text-green-900/75">באישור חד־פעמי, המכשיר הזה יקבל עדכונים על כל התורים ובקשות ההמתנה שתיצרו בעתיד מאותו מכשיר אצל העסק הזה. אם המכשיר משותף, גם אנשים אחרים שמשתמשים בו עשויים לראות את ההתראות. אפשר לבטל בכל עת. לא יישלחו הודעות שיווקיות.</p>
                    <button type="button" disabled={waitlistPushState.busy} onClick={() => void optInForPush(waitlistPushCapability, 'waitlist')}
                      className="mt-3 min-h-11 rounded-full border border-primary/25 bg-white px-4 py-2 text-sm font-semibold text-primary disabled:opacity-50">
                      {waitlistPushState.busy ? 'מפעילים…' : 'אישור וקבלת עדכונים'}
                    </button>
                    {waitlistPushState.status && <p role="status" className="mt-2 text-xs">{waitlistPushState.status}</p>}
                  </>
                )}
              </div>
            )}
          </div>
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
            <label className="block min-w-0 text-sm">תאריך מועדף *
              <input required type="date" min={todayDate} value={waitlistPreferredDate} onChange={(e) => setWaitlistPreferredDate(e.target.value)} className={`${input} block`}/>
            </label>
            <label className="block text-sm">שעה מועדפת (רשות)
              <input type="time" value={waitlistPreferredTime} onChange={(e) => setWaitlistPreferredTime(e.target.value)} className={input}/>
            </label>
            <label className="block text-sm">הערה (רשות)
              <textarea maxLength={500} rows={3} value={waitlistNote} onChange={(e) => setWaitlistNote(e.target.value)} className={input}/>
            </label>
            <div className="flex gap-2">
              <button type="button" disabled={waitlistBusy} onClick={() => { setWaitlistOpen(false); setWaitlistError(null); }} className="min-h-11 flex-1 rounded-xl border border-ink/20 px-3">{hasAppointmentHours ? 'חזרה ליומן' : 'חזרה'}</button>
              <button type="submit" disabled={waitlistBusy} className="min-h-11 flex-1 rounded-xl bg-primary/10 px-3 font-medium text-primary transition hover:bg-primary/10 disabled:opacity-50">
                {waitlistBusy ? 'שולחים…' : 'שליחת בקשת המתנה'}
              </button>
            </div>
          </form>
        ) : null}

        {waitlistOpen || waitlistDone ? null : done ? (
          <div className="py-4 text-center">
            <p ref={successRef} tabIndex={-1} role="status" aria-live="polite" aria-atomic="true" className="mb-4 text-lg font-medium focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">
              {done.message}
            </p>
            {done.route === 'whatsapp' && <a href={done.url} onClick={() => dlg.current?.close()} aria-label="פתיחת WhatsApp עם פרטי ההזמנה" className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[#168A52]/10 px-5 py-2 font-medium text-[#168A52] transition hover:bg-[#168A52]/10">שליחת פרטי ההזמנה ב־WhatsApp</a>}
            {done.pushCapabilityToken && pushPublicKey && (
              <div className="mx-auto mt-4 max-w-md rounded-xl border border-primary/20 bg-primary/5 p-3 text-start">
                {pushRevoked.appointment ? (
                  <div>
                    <p role="status" className="text-sm text-ink/75">{appointmentPushState.status ?? 'ההתראות בוטלו לעסק הזה.'}</p>
                    <button type="button" disabled={appointmentPushState.busy} onClick={() => void optInForPush(done.pushCapabilityToken!, 'appointment', true)}
                      className="mt-2 text-xs underline disabled:opacity-50">הפעלת התראות מחדש</button>
                  </div>
                ) : appointmentPushState.success ? (
                  <div>
                    <p role="status" className="text-sm text-ink/75">{appointmentPushState.status}</p>
                    <button type="button" disabled={appointmentPushState.busy} onClick={() => void cancelPushForBusiness('appointment')}
                      className="mt-2 text-xs underline disabled:opacity-50">{appointmentPushState.busy ? 'מבטלים…' : 'ביטול התראות מהעסק הזה'}</button>
                  </div>
                ) : pushEnvironment === 'ios-home-screen-required' ? (
                  <p className="text-sm leading-6 text-ink/75">ב-iPhone או iPad, Push זמין רק באתר שהותקן למסך הבית (iOS/iPadOS 16.4 ומעלה). כדי לקבל התראות על הזמנה חדשה, פתחו ב-Safari, לחצו על שיתוף ואז „הוספה למסך הבית”; לאחר מכן פתחו את האתר מהסמל החדש ובצעו ממנו את ההזמנה. הזמנה שכבר בוצעה בטאב Safari אינה מקושרת אוטומטית לאפליקציה שהותקנה.</p>
                ) : pushEnvironment === 'checking' ? (
                  <p className="text-sm text-ink/75">בודקים תמיכה בהתראות במכשיר…</p>
                ) : pushEnvironment === 'unsupported' ? (
                  <p className="text-sm text-ink/75">הדפדפן או מצב הגלישה הנוכחי אינם תומכים בהתראות Push.</p>
                ) : (
                  <>
                    <p className="font-semibold">לקבל עדכונים על התורים שלכם בעסק הזה?</p>
                    <p className="mt-1 text-xs leading-5 text-ink/65">באישור חד־פעמי, המכשיר הזה יקבל עדכונים על כל התורים ובקשות ההמתנה שתיצרו בעתיד מאותו מכשיר אצל העסק הזה. אם המכשיר משותף, גם אנשים אחרים שמשתמשים בו עשויים לראות את ההתראות. אפשר לבטל בכל עת. לא יישלחו הודעות שיווקיות.</p>
                    <button type="button" disabled={appointmentPushState.busy} onClick={() => void optInForPush(done.pushCapabilityToken!, 'appointment')}
                      className="mt-3 min-h-11 rounded-full border border-primary/25 bg-surface px-4 py-2 text-sm font-semibold text-primary disabled:opacity-50">
                      {appointmentPushState.busy ? 'מפעילים…' : 'אישור וקבלת עדכונים'}
                    </button>
                    {appointmentPushState.status && <p role="status" className="mt-2 text-xs text-ink/70">{appointmentPushState.status}</p>}
                  </>
                )}
              </div>
            )}
          </div>
        ) : step === 'choose' && !waitlistOpen && !waitlistDone ? (
          <div className="space-y-3">
            {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
            {kind === 'service' ? (
              <>
                {calendarEnabled && hasAppointmentHours && <button type="button" disabled={busy !== null} onClick={() => { setError(null); setStep('reserve'); }}
                  className="min-h-12 w-full rounded-xl bg-primary/10 px-4 py-3 font-medium text-primary disabled:opacity-50">קביעת תור ביומן</button>}
                {calendarEnabled && !hasAppointmentHours && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">העסק עדיין לא הגדיר שעות פעילות. אפשר להשאיר בקשת המתנה או לפנות ב-WhatsApp.</p>}
                {calendarEnabled && !hasAppointmentHours && <button type="button" onClick={openWaitlist}
                  className="min-h-12 w-full rounded-xl border border-primary/25 px-4 py-3 font-medium text-primary">בקשת הצטרפות לרשימת המתנה</button>}
                {whatsappEnabled && <button type="button" disabled={busy !== null} onClick={() => submit('whatsapp')}
                  className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#168A52]/10 px-4 py-3 font-medium text-[#168A52] disabled:opacity-50">
                  {busy === 'whatsapp' ? 'מכין הודעה…' : 'פנייה ב-WhatsApp'}
                </button>}
              </>
            ) : (
              <>
                {whatsappEnabled && <button type="button" disabled={busy !== null} onClick={() => submit('whatsapp')}
                  className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#168A52]/10 px-4 py-3 font-medium text-[#168A52] disabled:opacity-50">
                  {busy === 'whatsapp' ? 'מכין הודעה…' : 'המשך ל־WhatsApp'}
                </button>}
                {crmEnabled && <button type="button" onClick={() => { setError(null); setStep('site'); }}
                  className="min-h-12 w-full rounded-xl bg-primary/10 px-4 py-3 font-medium text-primary">השארת פנייה באתר</button>}
              </>
            )}
            <p className="text-center text-xs leading-5 text-ink/60">{kind === 'service' ? 'בחרו דרך אחת להמשך עבור כל השירותים שנבחרו.' : 'הפריטים שבחרתם יצורפו לפנייה. מעבר ל־WhatsApp אינו שולח את ההודעה במקומכם.'}</p>
          </div>
        ) : step === 'reserve' ? (
          <form onSubmit={(e) => { e.preventDefault(); submit('reserve'); }} className="space-y-3">
            {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
            <label className="block text-sm font-medium">מספר טלפון לקביעת התור *
              <input name="tel" autoComplete="tel" dir="ltr" type="tel" required className={input} value={form.phone} onChange={setField('phone')} placeholder="0500000000" />
            </label>
            <div className="flex gap-2">
              <button type="button" onClick={() => { setError(null); setStep('choose'); }} className="min-h-12 flex-1 rounded-xl border border-ink/20 px-4 py-3">חזרה</button>
              <button type="submit" disabled={busy !== null || !appointmentDate || !appointmentTime || !hasAppointmentHours} className="min-h-12 flex-1 rounded-xl bg-primary/10 px-4 py-3 font-medium text-primary disabled:opacity-50">
                {busy === 'reserve' ? 'שומר תור…' : 'אישור וקביעת התור'}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); submit('site'); }} className="space-y-3">
            {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
            <input type="text" tabIndex={-1} className="hidden" value={form.hp} onChange={setField('hp')} autoComplete="off" />
            <div>
              <label htmlFor={`${kind}-lead-name`} className="block text-sm font-medium">שם (רשות)</label>
              <input id={`${kind}-lead-name`} name="name" autoComplete="name" type="text" className={input} value={form.name} onChange={setField('name')} />
            </div>
            <div>
              <label htmlFor={`${kind}-lead-phone`} className="block text-sm font-medium">מספר טלפון *</label>
              <input id={`${kind}-lead-phone`} name="tel" autoComplete="tel" dir="ltr" type="tel" required className={input} value={form.phone} onChange={setField('phone')} placeholder="0500000000" />
            </div>
            <div>
              <label htmlFor={`${kind}-lead-email`} className="block text-sm font-medium">אימייל (רשות)</label>
              <input id={`${kind}-lead-email`} name="email" autoComplete="email" dir="ltr" type="email" className={input} value={form.email} onChange={setField('email')} />
            </div>
            <div className="flex gap-2 pt-2">
              {whatsappEnabled && <button type="button" onClick={() => { setError(null); setStep('choose'); }}
                className="min-h-12 flex-1 rounded-xl px-4 py-3 font-medium text-ink/70 transition hover:bg-ink/5">חזרה</button>}
              <button type="submit" disabled={busy !== null}
                className="min-h-12 flex-1 rounded-xl bg-primary/10 px-4 py-3 font-medium text-primary disabled:opacity-50">
                {busy === 'site' ? 'שומר…' : 'שליחת הפנייה'}
              </button>
            </div>
          </form>
        )}
      </dialog>
      {kind === 'service' && (customerPushActive || customerPushManageStatus) && (
        <div className="mt-8 border-t border-ink/10 pt-3 text-center">
          {customerPushActive && (
            <button type="button" onClick={() => void cancelCustomerPush()} className="text-xs text-ink/55 underline underline-offset-2">
              ניהול התראות מהעסק
            </button>
          )}
          {customerPushManageStatus && <p role="status" className="mt-2 text-xs text-ink/55">{customerPushManageStatus}</p>}
        </div>
      )}
    </section>
  );
}