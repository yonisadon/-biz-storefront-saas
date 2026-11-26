'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { mcall } from '@/lib/manageApi';
import { getWebPushEnvironment } from '@/lib/pushPlatform';
import { usePlatformLanguage } from '@/components/PlatformLanguageProvider';

type Settings = {
  entitled: boolean;
  configured: boolean;
  public_key: string | null;
  seller_enabled: boolean;
  customer_enabled: boolean;
  seller_effective: boolean;
  customer_effective: boolean;
};

function applicationServerKey(value: string): ArrayBuffer {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const raw = atob(value.replace(/-/g, '+').replace(/_/g, '/') + padding);
  const bytes = Uint8Array.from(raw, (char) => char.charCodeAt(0));
  return bytes.buffer as ArrayBuffer;
}

function withPushTimeout<T>(promise: Promise<T>, milliseconds: number, onTimeout?: () => void): Promise<T> {
  let timer: number;
  const timeout = new Promise<T>((_, reject) => {
    timer = window.setTimeout(() => {
      onTimeout?.();
      reject(new Error('push_timeout'));
    }, milliseconds);
  });
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timer));
}

export default function PushSettingsPanel({ token }: { token: string }) {
  const { t } = usePlatformLanguage();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [deviceSubscribed, setDeviceSubscribed] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported' | 'ios-home-screen-required'>('default');
  const deviceOperationRef = useRef(false);
  const deviceAttemptRef = useRef(0);
  const deviceStateRefreshRef = useRef(0);

  const refreshDeviceState = useCallback(async () => {
    const refreshId = ++deviceStateRefreshRef.current;
    const isLatestRefresh = () => deviceStateRefreshRef.current === refreshId;
    const environment = getWebPushEnvironment();
    if (environment === 'ios-home-screen-required') {
      if (isLatestRefresh()) {
        setPermission('ios-home-screen-required');
        setDeviceSubscribed(false);
      }
      return;
    }
    if (environment === 'unsupported') {
      if (isLatestRefresh()) {
        setPermission('unsupported');
        setDeviceSubscribed(false);
      }
      return;
    }
    const currentPermission = Notification.permission;
    setPermission(currentPermission);
    const registration = await withPushTimeout(navigator.serviceWorker.getRegistration('/'), 10000);
    if (!isLatestRefresh()) return;
    const subscription = await (registration ? withPushTimeout(registration.pushManager.getSubscription(), 10000) : Promise.resolve(null));
    if (!isLatestRefresh()) return;
    if (!subscription) {
      setDeviceSubscribed(false);
      return;
    }
    const status = await withPushTimeout(mcall<{ active: boolean }>(token, 'push/subscriptions/status', {
      method: 'POST',
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    }), 10000);
    if (!isLatestRefresh()) return;
    setDeviceSubscribed(status.active);
  }, [token]);

  const load = useCallback(async () => {
    try {
      const value = await withPushTimeout(mcall<Settings>(token, 'push/settings'), 15000);
      setSettings(value);
      await refreshDeviceState();
    } catch {
      setMessage(t('pushLoadFailed'));
    } finally {
      setLoading(false);
    }
  }, [token, refreshDeviceState, t]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const refreshAfterSettings = () => {
      if (document.visibilityState !== 'visible' || deviceOperationRef.current) return;
      // Do not invalidate an active permission/registration/subscription flow
      // just because the browser or app became visible again.
      void refreshDeviceState().catch(() => {
        setMessage(t('pushPermissionCheckFailed'));
      });
    };
    document.addEventListener('visibilitychange', refreshAfterSettings);
    window.addEventListener('pageshow', refreshAfterSettings);
    return () => {
      document.removeEventListener('visibilitychange', refreshAfterSettings);
      window.removeEventListener('pageshow', refreshAfterSettings);
    };
  }, [refreshDeviceState, t]);

  async function updatePreference(field: 'seller_enabled' | 'customer_enabled', enabled: boolean) {
    if (!settings || saving) return;
    setSaving(true);
    setMessage('');
    try {
      const controller = new AbortController();
      const value = await withPushTimeout(mcall<Partial<Settings>>(token, 'push/settings', {
        method: 'PATCH',
        body: JSON.stringify({ [field]: enabled }),
        signal: controller.signal,
      }), 15000, () => controller.abort());
      const next = { ...settings, ...value };
      setSettings({
        ...next,
        seller_effective: next.entitled && next.configured && next.seller_enabled,
        customer_effective: next.entitled && next.configured && next.customer_enabled,
      });
      setMessage(t('preferenceSaved'));
    } catch {
      setMessage(t('preferenceSaveFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function enableThisDevice() {
    if (!settings?.public_key || saving || deviceOperationRef.current) return;
    const attempt = ++deviceAttemptRef.current;
    deviceStateRefreshRef.current += 1;
    const isCurrent = () => deviceAttemptRef.current === attempt;
    deviceOperationRef.current = true;
    setSaving(true);
    setMessage('');
    try {
      const environment = getWebPushEnvironment();
      if (environment === 'ios-home-screen-required') throw new Error('ios_home_screen_required');
      if (environment === 'unsupported') throw new Error('unsupported');
      if (Notification.permission === 'denied') throw new Error('permission');
      const granted = Notification.permission === 'granted'
        ? 'granted'
        : await withPushTimeout(Notification.requestPermission(), 45000);
      if (!isCurrent()) return;
      if (granted !== 'granted') throw new Error('permission');

      await withPushTimeout(navigator.serviceWorker.register('/sw.js'), 15000);
      if (!isCurrent()) return;
      // register() can resolve while the worker is still installing. Wait for
      // the active root-scope worker before using PushManager.
      const registration = await withPushTimeout(navigator.serviceWorker.ready, 15000);
      if (!isCurrent()) return;
      if (!registration.active) throw new Error('service_worker_inactive');
      let subscription = await withPushTimeout(registration.pushManager.getSubscription(), 10000);
      if (!isCurrent()) return;
      if (!subscription) {
        subscription = await withPushTimeout(registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey(settings.public_key),
        }), 20000);
      }
      if (!isCurrent()) return;
      const json = subscription.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new Error('subscription');
      const controller = new AbortController();
      await withPushTimeout(mcall(token, 'push/subscriptions', {
        method: 'POST',
        body: JSON.stringify({ subscription: { endpoint: json.endpoint, keys: json.keys } }),
        signal: controller.signal,
      }), 15000, () => controller.abort());
      if (!isCurrent()) return;
      setDeviceSubscribed(true);
      setPermission('granted');
      setMessage(t('sellerPushEnabled'));
    } catch (error) {
      if (!isCurrent()) return;
      const reason = error instanceof Error ? error.message : '';
      setMessage(reason === 'ios_home_screen_required'
        ? t('iosPushSetup')
        : reason === 'permission'
          ? t('pushPermissionDenied')
          : reason === 'unsupported'
          ? t('pushUnsupported')
          : reason === 'service_worker_inactive'
            ? t('pushStillLoading')
            : reason === 'push_timeout'
              ? t('pushDelayed')
              : t('pushRegisterFailed'));
      void refreshDeviceState().catch(() => undefined);
    } finally {
      if (isCurrent()) {
        deviceOperationRef.current = false;
        setSaving(false);
      }
    }
  }

  async function disableThisDevice() {
    if (saving) return;
    setSaving(true);
    deviceStateRefreshRef.current += 1;
    setMessage('');
    try {
      const registration = await withPushTimeout(navigator.serviceWorker.getRegistration('/'), 10000);
      const subscription = await (registration ? withPushTimeout(registration.pushManager.getSubscription(), 10000) : Promise.resolve(null));
      if (subscription) {
        await withPushTimeout(mcall(token, 'push/subscriptions', {
          method: 'DELETE',
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        }), 15000);
      }
      // Keep the browser subscription: customer consent may use this same endpoint.
      setDeviceSubscribed(false);
      setMessage(t('sellerPushDisabled'));
    } catch {
      setMessage(t('pushUnsubscribeFailed'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p role="status" className="rounded-xl border border-ink/10 bg-white p-4 text-sm text-ink/60">{t('loadingPushSettings')}</p>;
  if (!settings) return <p role="alert" className="rounded-xl border border-ink/10 bg-white p-4 text-sm text-ink/70">{message || t('pushSettingsUnavailable')}</p>;

  return (
    <section className="space-y-4 rounded-2xl border border-ink/10 bg-white p-4 sm:p-5">
      <div>
        <p className="text-xs font-bold tracking-wide text-primary">Push</p>
        <h2 className="mt-1 text-xl font-bold text-ink">{t('pushBusinessTitle')}</h2>
      </div>

      {!settings.entitled && (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{t('pushUnavailableForBusiness')}</p>
      )}
      {settings.entitled && !settings.configured && (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{t('pushServiceNotConfigured')}</p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex items-start gap-3 rounded-xl border border-ink/10 p-3">
          <input type="checkbox" checked={settings.seller_enabled} disabled={saving || (!settings.entitled && !settings.seller_enabled)}
            onChange={(event) => void updatePreference('seller_enabled', event.target.checked)} className="mt-1 h-4 w-4 accent-primary" />
          <span>
            <span className="block text-sm font-bold">{t('pushSeller')}</span>
            <span className="mt-1 block text-xs leading-5 text-ink/60">{t('pushSellerDescription')}</span>
          </span>
        </label>
        <label className="flex items-start gap-3 rounded-xl border border-ink/10 p-3">
          <input type="checkbox" checked={settings.customer_enabled} disabled={saving || (!settings.entitled && !settings.customer_enabled)}
            onChange={(event) => void updatePreference('customer_enabled', event.target.checked)} className="mt-1 h-4 w-4 accent-primary" />
          <span>
            <span className="block text-sm font-bold">{t('pushCustomers')}</span>
            <span className="mt-1 block text-xs leading-5 text-ink/60">{t('pushCustomerDescription')}</span>
          </span>
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink/10 p-3">
        <div className="min-w-0">
          <p className="text-sm font-bold">{t('pushThisDevice')}</p>
          <p className="mt-1 text-xs leading-5 text-ink/60">{permission === 'denied' ? t('permissionBlockedHint') : permission === 'ios-home-screen-required' ? t('iosHomeScreenHint') : permission === 'unsupported' ? t('pushUnsupportedHint') : deviceSubscribed ? t('deviceSubscribedHint') : t('enableDeviceHint')}</p>
        </div>
        {deviceSubscribed ? (
          <button type="button" onClick={() => void disableThisDevice()} disabled={saving}
            className="min-h-10 rounded-full border border-ink/20 px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50">{t('disableOnDevice')}</button>
        ) : permission === 'unsupported' || permission === 'denied' || permission === 'ios-home-screen-required' ? null : (
          <button type="button" onClick={() => void enableThisDevice()} disabled={saving || !settings.seller_effective}
            className="min-h-10 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-fg disabled:opacity-50">{t('enableOnDevice')}</button>
        )}
      </div>
      {message && <p role="status" className="text-sm text-ink/70">{message}</p>}
    </section>
  );
}
