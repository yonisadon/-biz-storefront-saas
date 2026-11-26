'use client';

import StorefrontCatalogItem from '@/components/StorefrontCatalogItem';
import { useStorefrontTranslation, useStorefrontLocale, useStorefrontDirection } from '@/components/StorefrontLanguageProvider';
import type { StorefrontMessageKey } from '@/lib/storefrontI18n';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ils, normalizeILPhone } from '@/lib/format';
import { getWebPushEnvironment, type WebPushEnvironment } from '@/lib/pushPlatform';
import { useStorefrontPushManagement } from '@/components/StorefrontPushManagement';
import type { ContactOptions, DayHours, Product, PublicCatalogPage } from '@/lib/types';

type Layout = 'cards' | 'gallery' | 'list' | 'grid' | 'carousel' | 'luxury_catalog';
type Props = { apiBase: string; items: Product[]; quoteLabel: string; contactOptions: ContactOptions; kind: 'product' | 'service'; businessTimezone: string; openingHours: Record<string, DayHours> | null; catalogTotal: number; hasMore: boolean; productLayout: Layout; serviceLayout: Layout };
type Route = 'whatsapp' | 'site' | 'reserve';
type Done = { route: 'site' | 'reserve'; message: string; pushCapabilityToken?: string } | { route: 'whatsapp'; url: string; message: string; pushCapabilityToken?: string };
type Step = 'choose' | 'site' | 'reserve';

type ApiErrorPayload = { issues?: { message: string }[]; error?: string; route?: string; whatsapp_url?: string; success_message?: string; push_capability_token?: string };

function errorText(status: number, d: ApiErrorPayload | null, t: (key: StorefrontMessageKey) => string): string {
  if (status === 429) return t('tooManyAttempts');
  if (status === 403) return t('businessSettingsChanged');
  if (d?.error === 'appointment_required') return t('chooseAppointment');
  if (d?.error === 'invalid_appointment_time') return t('appointmentUnavailable');
  if (d?.error === 'contact_required') return t('phoneForBooking');
  if (d?.error === 'calendar_booking_disabled' || d?.error === 'route_disabled') return t('routeDisabled');
  if (d?.error === 'mixed_catalog_types' || d?.error === 'invalid_contact_flow') return t('separateCatalogFlows');
  if (d?.error === 'whatsapp_not_configured') return t('whatsappNotConfigured');
  const msgs: string[] = (d?.issues ?? []).map((i) => i.message);
  if (msgs.includes('invalid_il_phone')) return t('invalidPhone');
  if (msgs.includes('items_or_message_required')) return t('chooseItemOrMessage');
  if (msgs.includes('contact_required')) return t('validPhoneRequired');
  if (msgs.includes('appointment_required')) return t('chooseAppointment');
  if (msgs.includes('invalid_appointment_time')) return t('appointmentUnavailable');
  if (d?.error === 'unknown_product') return t('itemUnavailable');
  if (d?.error === 'slot_taken' || d?.error === 'slot_blocked') return t('slotUnavailable');
  return t('sendFailed');
}

function Stepper({ q, onChange, label, canRemove, t }: { q: number; onChange: (n: number) => void; label: string; canRemove: boolean; t: (key: StorefrontMessageKey) => string }) {
  const btn = 'h-9 w-9 rounded-full border-0 text-lg leading-none flex items-center justify-center text-primary transition hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-40';
  return (
    <div className="flex items-center gap-1" role="group" aria-label={label}>
      <button type="button" disabled={q <= 1 && !canRemove} className={btn} aria-label={t('removeQuantity')} onClick={() => onChange(q - 1)}>−</button>
      <span className="w-8 text-center font-semibold" aria-live="polite">{q}</span>
      <button type="button" className={btn} aria-label={t('addQuantity')} onClick={() => onChange(q + 1)}>+</button>
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
  const t = useStorefrontTranslation();
  const storefrontLocale = useStorefrontLocale();
  const storefrontDirection = useStorefrontDirection();
  // Hebrew and US English calendars conventionally start on Sunday; Russian starts on Monday.
  const firstDayOffset = storefrontLocale.toLowerCase().startsWith('ru') ? 1 : 0;

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

  const cancelCustomerPush = useCallback(async () => {
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
      setCustomerPushManageStatus(t('pushCanceled'));
    } catch {
      setCustomerPushManageStatus(t('pushCancelFailed'));
    }
  }, [apiBase, t]);

  useStorefrontPushManagement(kind === 'service', customerPushActive, customerPushManageStatus, cancelCustomerPush);

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
      setTargetState({ busy: false, success: true, status: t('pushEnabled') });
    } catch (error) {
      if (!isCurrent()) return;
      const code = error instanceof Error ? error.message : '';
      const aborted = error instanceof DOMException && error.name === 'AbortError';
      setTargetState({
        busy: false,
        success: false,
        status: code === 'push_permission_blocked' || code === 'push_permission_denied'
          ? t('pushBlocked')
          : code === 'push_not_supported'
            ? t('pushUnsupported')
            : code === 'customer_push_disabled' || code === 'push_not_available'
              ? t('pushUnavailable')
              : code === 'push_consent_expired'
                ? t('pushConsentExpired')
                : code === 'push_consent_already_used'
                  ? t('pushConsentUsed')
                  : code === 'push_not_configured'
                    ? t('pushNotConfigured')
                    : code === 'push_timeout'
                      ? pushStage === 'service_worker'
                        ? t('pushWorkerLoading')
                        : pushStage === 'subscription'
                          ? t('pushSubscriptionSlow')
                          : pushStage === 'consent'
                            ? t('pushConsentSlow')
                            : t('pushPermissionIncomplete')
                      : aborted || code === 'AbortError'
                        ? t('pushConsentSlow')
                      : code === 'push_service_worker_inactive'
                        ? t('pushWorkerLoading')
                        : t('pushEnableFailed'),
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
      setCustomerPushManageStatus(t('pushCanceled'));
      setTargetState({ busy: false, success: false, status: t('pushCanceled') });
    } catch {
      setTargetState((current) => ({ ...current, busy: false, status: t('pushCancelFailed') }));
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
      .catch(() => { if (!cancelled) setCatalogError(t('searchFailed')); })
      .finally(() => { if (!cancelled) setSearching(false); });
    return () => { cancelled = true; };
  }, [apiBase, search, initialItems, initiallyHasMore, catalogTotal, kind, t]);

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
    } catch { setCatalogError(t('loadMoreFailed')); }
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
    const calendarWeekday = new Date(Date.UTC(year, month - 1, 1, 12)).getUTCDay();
    const firstWeekday = (calendarWeekday - firstDayOffset + 7) % 7;
    const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return Array.from({ length: firstWeekday + count }, (_, index) => {
      if (index < firstWeekday) return null;
      return `${year}-${String(month).padStart(2, '0')}-${String(index - firstWeekday + 1).padStart(2, '0')}`;
    });
  }, [appointmentMonth, firstDayOffset]);
  const moveAppointmentMonth = (delta: number) => {
    const [year, month] = appointmentMonth.split('-').map(Number);
    const next = new Date(Date.UTC(year, month - 1 + delta, 1, 12));
    setAppointmentMonth(`${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`);
  };
  const appointmentMonthLabel = new Intl.DateTimeFormat(storefrontLocale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${appointmentMonth}-01T12:00:00Z`));
  const todayDate = dateInTimezone(businessTimezone);
  const appointmentSlots = serverAppointmentSlots;
  const appointmentTimeGroups = [
    { label: t('morning'), slots: appointmentSlots.filter((slot) => Number(slot.slice(0, 2)) < 12) },
    { label: t('afternoon'), slots: appointmentSlots.filter((slot) => Number(slot.slice(0, 2)) >= 12 && Number(slot.slice(0, 2)) < 17) },
    { label: t('evening'), slots: appointmentSlots.filter((slot) => Number(slot.slice(0, 2)) >= 17) },
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
    if (count === 0) return setError(kind === 'product' ? t('chooseProduct') : t('chooseService'));
    if (route === 'reserve' && !hasAppointmentHours) return setError(t('noBookingHours'));
    if (route === 'reserve' && (!appointmentDate || !appointmentTime)) return setError(t('chooseDateTime'));
    if ((route === 'site' || route === 'reserve') && !phone) return setError(t('israelPhoneRequired'));

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
      if (!res.ok) return setError(errorText(res.status, data, t));

      // The server has confirmed persistence. Clear the order immediately so
      // returning from WhatsApp cannot accidentally submit the same cart again.
      setIdempotencyKey('');
      setCart({});
      setAppointmentDate('');
      setAppointmentTime('');
      setServerAppointmentSlots([]);
      if (route === 'whatsapp') {
        if (!data?.whatsapp_url) return setError(t('whatsappLinkFailed'));
        setDone({ route: 'whatsapp', url: data.whatsapp_url, message: data.success_message ?? t('inquirySavedWhatsapp'), pushCapabilityToken: data.push_capability_token });
      } else {
        setDone({ route, message: data?.success_message ?? (route === 'reserve' ? t('appointmentSaved') : t('inquirySent')), pushCapabilityToken: data?.push_capability_token });
      }
    } catch {
      setError(t('networkError'));
    } finally {
      setBusy(null);
    }
  }

  async function submitWaitlist(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWaitlistError(null);
    if (!waitlistPreferredDate) return setWaitlistError(t('choosePreferredDate'));
    const phone = normalizeILPhone(form.phone);
    if (!phone) return setWaitlistError(t('israelPhoneRequired'));
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
          setWaitlistError(t('duplicateWaitlist'));
        } else if (data?.error === 'preferred_date_in_past') {
          setWaitlistError(t('preferredDatePast'));
        } else if (data?.error === 'invalid_waitlist_services' || data?.error === 'calendar_booking_disabled') {
          setWaitlistError(t('waitlistUnavailable'));
        } else if (response.status === 429) {
          setWaitlistError(t('tooManyWaitlist'));
        } else {
          setWaitlistError(t('waitlistFailed'));
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
      setWaitlistError(t('networkError'));
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
        <h2 ref={sectionHeadingRef} id={kind === 'product' ? 'products-h' : 'services-h'} tabIndex={-1} className="text-2xl font-bold">{kind === 'product' ? t('ourProducts') : t('ourServices')}</h2>
      </div>
      {(items.length > 0 || search.trim()) && <p className="mt-1 text-sm leading-5 text-ink/65">{kind === 'product' ? t('selectProductToAdd') : t('selectServiceToAdd')}</p>}

      {catalogTotal >= 5 && (
        <div className="mt-4">
          <label htmlFor={`storefront-${kind}-search`} className="sr-only">{kind === 'product' ? t('searchProducts') : t('searchServices')}</label>
          <input id={`storefront-${kind}-search`} type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('searchByNameOrDescription')} className="min-h-11 w-full rounded-xl border border-ink/20 bg-white px-4 py-2 text-start focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" />
        </div>
      )}
      {searching && <p role="status" className="mt-3 text-sm text-ink/65">{t('searchingItems')}</p>}
      {!searching && search.trim() && items.length === 0 && !catalogError && <p className="mt-4 text-sm text-ink/65">{t('noSearchResults')}</p>}

      {items.length > 0 && (
        <div className="mt-3 space-y-5">
          {(['product', 'service'] as const).map((kind) => {
            const groupItems = items.filter((item) => item.kind === kind);
            if (!groupItems.length) return null;
            const layout = kind === 'product' ? productLayout : serviceLayout;
            return <section key={kind} id={kind === 'service' ? 'services-subsection' : 'products-subsection'} data-profile-section={kind} aria-label={kind === 'product' ? t('products') : t('services')}>
              {items.some((item) => item.kind === 'product') && items.some((item) => item.kind === 'service') && <h3 className="mb-2 text-lg font-bold">{kind === 'product' ? t('products') : t('services')}</h3>}
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
        <p className="text-sm text-ink/60">{t('itemsShown')} {items.length} {t('of')} {search.trim() ? searchTotal : catalogTotal} {t('items')}</p>
        {catalogError && <p role="alert" className="text-sm text-red-700">{catalogError}</p>}
        {hasMore && <button type="button" onClick={loadMore} disabled={loadingMore} className="min-h-11 rounded-full border border-ink/25 bg-white px-5 py-2.5 text-sm font-semibold text-ink hover:bg-ink/5 disabled:opacity-50">
          {loadingMore ? t('loadingItems') : t('showMoreItems')}
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
              aria-label={kind === 'product' ? t('clearProductSelection') : t('clearServiceSelection')}
              title={kind === 'product' ? t('clearProducts') : t('clearServices')}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xl text-ink/65 transition hover:bg-ink/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <span aria-hidden="true">×</span>
            </button>
            <div className="min-w-0">
              <div className="text-xs text-ink/70">{count} {kind === 'product' ? t('selectedProducts') : t('selectedServices')}</div>
              <div className="font-bold text-lg">{totalText}</div>
            </div>
          </div>
          <button ref={openerRef} type="button" onClick={openContinuation}
            className="min-h-11 shrink-0 rounded-full border-0 bg-primary/10 px-4 py-2.5 text-sm font-medium text-primary transition hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:px-6">
            {kind === 'product' ? t('continueToInquiry') : t('chooseCoordinationMethod')}
          </button>
        </div>
      )}

      {/* Order Modal */}
      <dialog ref={dlg} aria-labelledby={`order-dialog-title-${kind}`} onClose={() => (openerRef.current ?? sectionHeadingRef.current)?.focus()} className="customer-order-dialog m-auto box-border max-h-[calc(100dvh-1rem)] w-[calc(100%-1.5rem)] max-w-[30rem] min-w-0 overflow-x-hidden overflow-y-auto overscroll-contain rounded-2xl bg-surface p-3 text-start shadow-xl backdrop:bg-black/50 sm:max-h-[calc(100dvh-2rem)] sm:p-6">
        <div className="mb-4 flex min-w-0 items-center justify-between gap-2">
          <h3 id={`order-dialog-title-${kind}`} className="min-w-0 text-xl font-bold">{kind === 'product' ? t('contactAboutProducts') : t('chooseCoordinationMethod')}</h3>
          <button type="button" onClick={() => dlg.current?.close()} aria-label={done ? t('closeConfirmation') : t('closeOrderDialog')} className="min-h-11 min-w-11 rounded-lg border border-ink/20 p-2 text-xl focus-visible:outline-2 focus-visible:outline-offset-2">✕</button>
        </div>

        {!done && !waitlistDone && (
          <div className="mb-4 rounded-xl bg-gray-50 p-3">
            <ul className="space-y-1.5 text-sm">
              {lines.map(({ p, q }) => {
                const durationLabel = p.kind === 'service' ? t('durationLabel') : '';
                return <li key={`${p.kind}:${p.id}`} data-cart-item-id={p.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-b border-gray-200 pb-3 last:border-b-0 last:pb-0">
                  <span className="min-w-0 break-words font-medium">{p.name} × {q}{durationLabel ? <span className="block text-xs font-normal text-ink/60">{durationLabel}: {p.appointment_duration_minutes * q} {t('minutes')}</span> : null}</span>
                  <span className="shrink-0 text-end font-medium">{p.price_agorot === null ? quoteLabel : ils(p.price_agorot * q)}</span>
                  {!done && (
                    <div className="col-span-2 flex min-w-0 items-center justify-between gap-3 border-t border-gray-200 pt-2">
                      <Stepper q={q} label={`${t('quantityLabel')}: ${p.name}`} canRemove={lines.length > 1} onChange={(next) => setQty(p, next)} t={t} />
                       {lines.length > 1 && <button type="button" onClick={() => setQty(p, 0)} className="min-h-9 rounded-lg px-3 text-sm font-medium text-red-700 underline underline-offset-2">{t('removeItem')}</button>}
                    </div>
                  )}
                </li>;
              })}
            </ul>
            {totalText && <div className="mt-3 flex justify-between border-t border-gray-200 pt-2 font-bold"><span>{t('estimatedTotal')}</span><span>{totalText}</span></div>}
          </div>
        )}

        {!done && !waitlistOpen && !waitlistDone && step === 'reserve' && needsAppointment && (
          <fieldset className="mb-4 space-y-3 rounded-xl border border-ink/15 p-3">
            <legend className="px-1 text-sm font-semibold">{t('appointmentCoordination')}</legend>
            {hasAppointmentHours ? (
              <>
                <p className="text-xs leading-5 text-ink/65">{t('appointmentDurationInfo').replace('{minutes}', String(reservedAppointmentDurationMinutes))}</p>
                <div className="space-y-3">
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-semibold">{t('selectDate')}</span>
                    <div className="flex min-w-0 items-center gap-1">
                      <button type="button" onClick={() => moveAppointmentMonth(-1)} disabled={appointmentMonth <= todayDate.slice(0, 7)} aria-label={t('previousMonth')} className="grid h-8 w-8 shrink-0 place-items-center rounded-full disabled:cursor-not-allowed disabled:opacity-30"><span aria-hidden="true" className={storefrontDirection === 'rtl' ? 'inline-block rotate-180' : 'inline-block'}>‹</span></button>
                      <span aria-live="polite" className="min-w-0 text-center text-sm font-semibold capitalize">{appointmentMonthLabel}</span>
                      <button type="button" onClick={() => moveAppointmentMonth(1)} aria-label={t('nextMonth')} className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-ink/20"><span aria-hidden="true" className={storefrontDirection === 'rtl' ? 'rotate-180' : ''}>›</span></button>
                      <button type="button" onClick={() => { const month = todayDate.slice(0, 7); setAppointmentMonth(month); if (appointmentDate.slice(0, 7) !== month) { setAppointmentDate(''); setAppointmentTime(''); setIdempotencyKey(''); } }} className="shrink-0 rounded-full px-2 py-2 text-xs font-medium text-primary underline underline-offset-2">{t('monthNow')}</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-7 gap-1 text-center text-xs text-ink/55">{([t('weekdaySundayShort'), t('weekdayMondayShort'), t('weekdayTuesdayShort'), t('weekdayWednesdayShort'), t('weekdayThursdayShort'), t('weekdayFridayShort'), t('weekdaySaturdayShort')].slice(firstDayOffset).concat([t('weekdaySundayShort'), t('weekdayMondayShort'), t('weekdayTuesdayShort'), t('weekdayWednesdayShort'), t('weekdayThursdayShort'), t('weekdayFridayShort'), t('weekdaySaturdayShort')].slice(0, firstDayOffset))).map((day) => <span key={day} className="py-1">{day}</span>)}</div>
                  <div role="group" aria-label={t('chooseDay')} className="grid min-w-0 grid-cols-7 gap-1">
                    {monthCells.map((date, index) => {
                      if (!date) return <span key={`empty-${index}`} aria-hidden="true" />;
                      const available = monthAvailableDates.includes(date);
                      const disabled = date < todayDate || !available || monthLoading || monthError;
                      const selected = appointmentDate === date;
                      return <button key={date} type="button" disabled={disabled} aria-pressed={selected} onClick={() => { setIdempotencyKey(''); setAppointmentDate(date); setAppointmentTime(''); }}
                        aria-label={`${new Intl.DateTimeFormat(storefrontLocale, { dateStyle: 'full', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`))}, ${available ? t('dayAvailable') : t('dayUnavailable')}`} className={`min-h-11 rounded-xl text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-30 ${selected ? 'bg-primary/10 text-primary ring-1 ring-primary/25' : available ? 'bg-primary/5 text-ink hover:bg-primary/10' : 'text-ink/35'}`}>
                        {Number(date.slice(-2))}{available && <span className="mx-auto mt-0.5 block h-1 w-1 rounded-full bg-current" aria-hidden="true" />}
                      </button>;
                    })}
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-[11px] text-ink/60"><span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-primary"/> {t('availableSlots')}</span><span>{t('unavailableDays')}</span></div>
                  {monthLoading && <p role="status" className="text-xs text-ink/60">{t('checkingMonth')}</p>}
                  {monthError && <p role="alert" className="text-xs text-red-700">{t('monthLoadError')}</p>}
                </div>
                <div className="space-y-2">
                  <span className="text-sm font-semibold">{t('availableTimes')}</span>
                  {!appointmentDate && <p className="text-sm text-ink/55">{t('chooseAvailableDay')}</p>}
                  {appointmentDate && slotsLoading && <p role="status" className="text-sm text-ink/55">{t('checkingDaySlots')}</p>}
                  {appointmentDate && slotsError && <p role="alert" className="text-sm text-red-700">{t('slotsLoadError')}</p>}
                  {appointmentDate && !slotsLoading && !slotsError && appointmentSlots.length === 0 && <p className="text-sm text-ink/55">{t('noSlotsToday')}</p>}
                  {appointmentTimeGroups.map((group) => group.slots.length > 0 && <div key={group.label}><p className="mb-1 text-xs font-medium text-ink/55">{group.label}</p><div className="flex flex-wrap gap-2">{group.slots.map((slot) => <button key={slot} type="button" aria-pressed={appointmentTime === slot} onClick={() => { setIdempotencyKey(''); setAppointmentTime((current) => current === slot ? '' : slot); }} className={`min-h-10 min-w-16 rounded-full px-4 py-2 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${appointmentTime === slot ? 'bg-primary/10 text-primary ring-1 ring-primary/25' : 'text-ink hover:bg-primary/5'}`}>{slot}</button>)}</div></div>)}
                </div>
                {appointmentDate && appointmentTime && <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-sm"><p className="font-semibold">{t('appointmentSummary')}</p><p className="mt-1">{reservedAppointmentLines.map(({ p, q }) => `${p.name}${q > 1 ? ` × ${q}` : ''}`).join(', ')}</p><p className="mt-1">{new Intl.DateTimeFormat(storefrontLocale, { dateStyle: 'full', timeZone: 'UTC' }).format(new Date(`${appointmentDate}T12:00:00Z`))} · {appointmentTime}</p><p className="mt-1 text-ink/65">{t('appointmentDuration')}: {reservedAppointmentDurationMinutes} {t('minutes')} · {t('priceLabel')}: {totalText || t('quotePrice')}</p></div>}
                {!appointmentTime && !monthLoading && !monthError && !slotsLoading && !slotsError && (
                  <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
                    <p className="text-sm font-semibold">{t('noSuitableTime')}</p>
                    <p className="mt-1 text-xs leading-5 text-ink/65">{t('waitlistExplain')}</p>
                    <button type="button" onClick={openWaitlist} className="mt-2 min-h-11 w-full rounded-xl border border-primary/30 bg-surface px-4 py-2 text-sm font-semibold text-primary">
                      {t('waitlistRequest')}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm leading-6 text-ink/75">{t('noBookingHours')}</p>
            )}
          </fieldset>
        )}


        {waitlistDone && (
          <div role="status" className="mb-4 rounded-xl bg-green-50 p-3 text-sm text-green-900">
            <p>{t('waitlistSuccess')}</p>
            {waitlistPushCapability && pushPublicKey && (
              <div className="mt-3">
                {pushRevoked.waitlist ? (
                  <div>
                    <p role="status" className="text-sm">{waitlistPushState.status ?? t('pushRevoked')}</p>
                    <button type="button" disabled={waitlistPushState.busy} onClick={() => void optInForPush(waitlistPushCapability, 'waitlist', true)}
                      className="mt-2 text-xs underline disabled:opacity-50">{t('pushReactivate')}</button>
                  </div>
                ) : waitlistPushState.success ? (
                  <div>
                    <p role="status" className="text-sm">{t('pushEnabled')}</p>
                    <button type="button" disabled={waitlistPushState.busy} onClick={() => void cancelPushForBusiness('waitlist')}
                      className="mt-2 text-xs underline disabled:opacity-50">{waitlistPushState.busy ? t('pushCancelBusy') : t('pushCancel')}</button>
                  </div>
                ) : pushEnvironment === 'ios-home-screen-required' ? (
                  <p className="text-sm leading-6 text-green-900">{t('pushIOS')}</p>
                ) : pushEnvironment === 'checking' ? (
                  <p className="text-sm text-green-900">{t('pushChecking')}</p>
                ) : pushEnvironment === 'unsupported' ? (
                  <p className="text-sm text-green-900">{t('pushBrowserUnsupported')}</p>
                ) : (
                  <>
                    <p className="font-semibold text-green-950">{t('pushAsk')}</p>
                    <p className="mt-1 text-xs leading-5 text-green-900/75">{t('pushConsentInfo')}</p>
                    <button type="button" disabled={waitlistPushState.busy} onClick={() => void optInForPush(waitlistPushCapability, 'waitlist')}
                      className="mt-3 min-h-11 rounded-full border border-primary/25 bg-white px-4 py-2 text-sm font-semibold text-primary disabled:opacity-50">
                      {waitlistPushState.busy ? t('pushEnableBusy') : t('pushConfirm')}
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
            <h3 className="font-semibold">{t('waitlistRequest')}</h3>
            {waitlistError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{waitlistError}</p>}
            <label className="block text-sm">{t('customerNameOptional')}
              <input type="text" maxLength={100} autoComplete="name" value={waitlistName} onChange={(e) => setWaitlistName(e.target.value)} className={input} placeholder={t('fullName')} />
            </label>
            <label className="block text-sm">{t('phoneRequired')}
              <input required type="tel" inputMode="tel" dir="ltr" value={form.phone} onChange={setField('phone')} className={input} placeholder="0500000000"/>
            </label>
            <label className="block min-w-0 text-sm">{t('preferredDate')}
              <input required type="date" min={todayDate} value={waitlistPreferredDate} onChange={(e) => setWaitlistPreferredDate(e.target.value)} className={`${input} block`}/>
            </label>
            <label className="block text-sm">{t('preferredTimeOptional')}
              <input type="time" value={waitlistPreferredTime} onChange={(e) => setWaitlistPreferredTime(e.target.value)} className={input}/>
            </label>
            <label className="block text-sm">{t('noteOptional')}
              <textarea maxLength={500} rows={3} value={waitlistNote} onChange={(e) => setWaitlistNote(e.target.value)} className={input}/>
            </label>
            <div className="flex gap-2">
              <button type="button" disabled={waitlistBusy} onClick={() => { setWaitlistOpen(false); setWaitlistError(null); }} className="min-h-11 flex-1 rounded-xl border border-ink/20 px-3">{hasAppointmentHours ? t('backToCalendar') : t('back')}</button>
              <button type="submit" disabled={waitlistBusy} className="min-h-11 flex-1 rounded-xl bg-primary/10 px-3 font-medium text-primary transition hover:bg-primary/10 disabled:opacity-50">
                {waitlistBusy ? t('sending') : t('sendWaitlist')}
              </button>
            </div>
          </form>
        ) : null}

        {waitlistOpen || waitlistDone ? null : done ? (
          <div className="py-4 text-center">
            <p ref={successRef} tabIndex={-1} role="status" aria-live="polite" aria-atomic="true" className="mb-4 text-lg font-medium focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">
              {done.message}
            </p>
            {done.route === 'whatsapp' && <a href={done.url} onClick={() => dlg.current?.close()} aria-label={t('pushWhatsAppAria')} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[#168A52]/10 px-5 py-2 font-medium text-[#168A52] transition hover:bg-[#168A52]/10">{t('pushWhatsAppSend')}</a>}
            {done.pushCapabilityToken && pushPublicKey && (
              <div className="mx-auto mt-4 max-w-md rounded-xl border border-primary/20 bg-primary/5 p-3 text-start">
                {pushRevoked.appointment ? (
                  <div>
                    <p role="status" className="text-sm text-ink/75">{appointmentPushState.status ?? t('pushRevoked')}</p>
                    <button type="button" disabled={appointmentPushState.busy} onClick={() => void optInForPush(done.pushCapabilityToken!, 'appointment', true)}
                      className="mt-2 text-xs underline disabled:opacity-50">{t('pushReactivate')}</button>
                  </div>
                ) : appointmentPushState.success ? (
                  <div>
                    <p role="status" className="text-sm text-ink/75">{appointmentPushState.status}</p>
                    <button type="button" disabled={appointmentPushState.busy} onClick={() => void cancelPushForBusiness('appointment')}
                      className="mt-2 text-xs underline disabled:opacity-50">{appointmentPushState.busy ? t('pushCancelBusy') : t('pushCancel')}</button>
                  </div>
                ) : pushEnvironment === 'ios-home-screen-required' ? (
                  <p className="text-sm leading-6 text-ink/75">{t('pushIOS')}</p>
                ) : pushEnvironment === 'checking' ? (
                  <p className="text-sm text-ink/75">{t('pushChecking')}</p>
                ) : pushEnvironment === 'unsupported' ? (
                  <p className="text-sm text-ink/75">{t('pushBrowserUnsupported')}</p>
                ) : (
                  <>
                    <p className="font-semibold">{t('pushAsk')}</p>
                    <p className="mt-1 text-xs leading-5 text-ink/65">{t('pushConsentInfo')}</p>
                    <button type="button" disabled={appointmentPushState.busy} onClick={() => void optInForPush(done.pushCapabilityToken!, 'appointment')}
                      className="mt-3 min-h-11 rounded-full border border-primary/25 bg-surface px-4 py-2 text-sm font-semibold text-primary disabled:opacity-50">
                      {appointmentPushState.busy ? t('pushEnableBusy') : t('pushConfirm')}
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
                  className="min-h-12 w-full rounded-xl bg-primary/10 px-4 py-3 font-medium text-primary disabled:opacity-50">{t('appointmentBooking')}</button>}
                {calendarEnabled && !hasAppointmentHours && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{t('businessNoHours')}</p>}
                {calendarEnabled && !hasAppointmentHours && <button type="button" onClick={openWaitlist}
                  className="min-h-12 w-full rounded-xl border border-primary/25 px-4 py-3 font-medium text-primary">{t('waitlistRequest')}</button>}
                {whatsappEnabled && <button type="button" disabled={busy !== null} onClick={() => submit('whatsapp')}
                  className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#168A52]/10 px-4 py-3 font-medium text-[#168A52] disabled:opacity-50">
                  {busy === 'whatsapp' ? t('prepareWhatsApp') : t('whatsappContact')}
                </button>}
              </>
            ) : (
              <>
                {whatsappEnabled && <button type="button" disabled={busy !== null} onClick={() => submit('whatsapp')}
                  className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#168A52]/10 px-4 py-3 font-medium text-[#168A52] disabled:opacity-50">
                  {busy === 'whatsapp' ? t('prepareWhatsApp') : t('continueWhatsApp')}
                </button>}
                {crmEnabled && <button type="button" onClick={() => { setError(null); setStep('site'); }}
                  className="min-h-12 w-full rounded-xl bg-primary/10 px-4 py-3 font-medium text-primary">{t('siteInquiry')}</button>}
              </>
            )}
            <p className="text-center text-xs leading-5 text-ink/60">{kind === 'service' ? t('chooseOneMethod') : t('productsInquiryNote')}</p>
          </div>
        ) : step === 'reserve' ? (
          <form onSubmit={(e) => { e.preventDefault(); submit('reserve'); }} className="space-y-3">
            {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
            <label className="block text-sm font-medium">{t('bookingPhone')}
              <input name="tel" autoComplete="tel" dir="ltr" type="tel" required className={input} value={form.phone} onChange={setField('phone')} placeholder="0500000000" />
            </label>
            <div className="flex gap-2">
              <button type="button" onClick={() => { setError(null); setStep('choose'); }} className="min-h-12 flex-1 rounded-xl border border-ink/20 px-4 py-3">{t('back')}</button>
              <button type="submit" disabled={busy !== null || !appointmentDate || !appointmentTime || !hasAppointmentHours} className="min-h-12 flex-1 rounded-xl bg-primary/10 px-4 py-3 font-medium text-primary disabled:opacity-50">
                {busy === 'reserve' ? t('savingAppointment') : t('confirmAppointment')}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); submit('site'); }} className="space-y-3">
            {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
            <input type="text" tabIndex={-1} className="hidden" value={form.hp} onChange={setField('hp')} autoComplete="off" />
            <div>
              <label htmlFor={`${kind}-lead-name`} className="block text-sm font-medium">{t('customerNameOptional')}</label>
              <input id={`${kind}-lead-name`} name="name" autoComplete="name" type="text" className={input} value={form.name} onChange={setField('name')} />
            </div>
            <div>
              <label htmlFor={`${kind}-lead-phone`} className="block text-sm font-medium">{t('phoneRequired')}</label>
              <input id={`${kind}-lead-phone`} name="tel" autoComplete="tel" dir="ltr" type="tel" required className={input} value={form.phone} onChange={setField('phone')} placeholder="0500000000" />
            </div>
            <div>
              <label htmlFor={`${kind}-lead-email`} className="block text-sm font-medium">{t('emailOptional')}</label>
              <input id={`${kind}-lead-email`} name="email" autoComplete="email" dir="ltr" type="email" className={input} value={form.email} onChange={setField('email')} />
            </div>
            <div className="flex gap-2 pt-2">
              {whatsappEnabled && <button type="button" onClick={() => { setError(null); setStep('choose'); }}
                className="min-h-12 flex-1 rounded-xl px-4 py-3 font-medium text-ink/70 transition hover:bg-ink/5">{t('back')}</button>}
              <button type="submit" disabled={busy !== null}
                className="min-h-12 flex-1 rounded-xl bg-primary/10 px-4 py-3 font-medium text-primary disabled:opacity-50">
                {busy === 'site' ? t('saving') : t('sendInquiry')}
              </button>
            </div>
          </form>
        )}
      </dialog>
    </section>
  );
}