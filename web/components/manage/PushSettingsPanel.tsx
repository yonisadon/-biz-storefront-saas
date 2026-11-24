'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { mcall } from '@/lib/manageApi';

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

export default function PushSettingsPanel({ token }: { token: string }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [deviceSubscribed, setDeviceSubscribed] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default');
  const deviceOperationRef = useRef(false);
  const deviceAttemptRef = useRef(0);

  const refreshDeviceState = useCallback(async () => {
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      setPermission('unsupported');
      setDeviceSubscribed(false);
      return;
    }
    const currentPermission = Notification.permission;
    setPermission(currentPermission);
    const registration = await navigator.serviceWorker.getRegistration('/');
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) {
      setDeviceSubscribed(false);
      return;
    }
    const status = await mcall<{ active: boolean }>(token, 'push/subscriptions/status', {
      method: 'POST',
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    });
    setDeviceSubscribed(currentPermission === 'granted' && status.active);
  }, [token]);

  const load = useCallback(async () => {
    try {
      const value = await mcall<Settings>(token, 'push/settings');
      setSettings(value);
      await refreshDeviceState();
    } catch {
      setMessage('לא הצלחנו לטעון את הגדרות ההתראות.');
    } finally {
      setLoading(false);
    }
  }, [token, refreshDeviceState]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const refreshAfterSettings = () => {
      if (document.visibilityState !== 'visible') return;
      void refreshDeviceState().catch(() => {
        setMessage('לא הצלחנו לבדוק את הרשאת ההתראות. אפשר לנסות שוב.');
      });
      if (deviceOperationRef.current) {
        deviceAttemptRef.current += 1;
        deviceOperationRef.current = false;
        setSaving(false);
        setMessage('חזרתם מהגדרות המכשיר. בדקו את ההרשאה ונסו שוב.');
      }
    };
    document.addEventListener('visibilitychange', refreshAfterSettings);
    window.addEventListener('pageshow', refreshAfterSettings);
    return () => {
      document.removeEventListener('visibilitychange', refreshAfterSettings);
      window.removeEventListener('pageshow', refreshAfterSettings);
    };
  }, [refreshDeviceState]);

  async function updatePreference(field: 'seller_enabled' | 'customer_enabled', enabled: boolean) {
    if (!settings || saving) return;
    setSaving(true);
    setMessage('');
    try {
      const value = await mcall<Partial<Settings>>(token, 'push/settings', {
        method: 'PATCH',
        body: JSON.stringify({ [field]: enabled }),
      });
      const next = { ...settings, ...value };
      setSettings({
        ...next,
        seller_effective: next.entitled && next.configured && next.seller_enabled,
        customer_effective: next.entitled && next.configured && next.customer_enabled,
      });
      setMessage('ההעדפה נשמרה.');
    } catch {
      setMessage('לא הצלחנו לשמור את ההעדפה. נסו שוב.');
    } finally {
      setSaving(false);
    }
  }

  async function enableThisDevice() {
    if (!settings?.public_key || saving) return;
    const attempt = ++deviceAttemptRef.current;
    const isCurrent = () => deviceAttemptRef.current === attempt;
    deviceOperationRef.current = true;
    setSaving(true);
    setMessage('');
    try {
      if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
        throw new Error('unsupported');
      }
      if (Notification.permission === 'denied') throw new Error('permission');
      const granted = Notification.permission === 'granted'
        ? 'granted'
        : await Notification.requestPermission();
      if (!isCurrent()) return;
      if (granted !== 'granted') throw new Error('permission');

      const registration = await navigator.serviceWorker.register('/sw.js');
      if (!isCurrent()) return;
      let subscription = await registration.pushManager.getSubscription();
      if (!isCurrent()) return;
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey(settings.public_key),
        });
      }
      if (!isCurrent()) return;
      const json = subscription.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new Error('subscription');
      await mcall(token, 'push/subscriptions', {
        method: 'POST',
        body: JSON.stringify({ subscription: { endpoint: json.endpoint, keys: json.keys } }),
      });
      if (!isCurrent()) return;
      setDeviceSubscribed(true);
      setPermission('granted');
      setMessage('ההתראות למוכר הופעלו במכשיר הזה.');
    } catch (error) {
      if (!isCurrent()) return;
      const reason = error instanceof Error ? error.message : '';
      setMessage(reason === 'permission'
        ? 'ההרשאה חסומה. אפשרו התראות בהגדרות האתר בדפדפן וחזרו לכאן.'
        : reason === 'unsupported'
          ? 'הדפדפן אינו תומך בהתראות Push במצב הנוכחי.'
          : 'לא הצלחנו לרשום את המכשיר. אפשר לנסות שוב.');
      await refreshDeviceState().catch(() => undefined);
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
    setMessage('');
    try {
      const registration = await navigator.serviceWorker.getRegistration('/');
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await mcall(token, 'push/subscriptions', {
          method: 'DELETE',
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
      }
      // Keep the browser subscription: customer consent may use this same endpoint.
      setDeviceSubscribed(false);
      setMessage('התראות למוכר כובו במכשיר הזה. הרשמת הדפדפן נשארת זמינה ללקוחות שאישרו בנפרד.');
    } catch {
      setMessage('לא הצלחנו להסיר את המכשיר. אפשר לנסות שוב.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p role="status" className="rounded-xl border border-ink/10 bg-white p-4 text-sm text-ink/60">טוען הגדרות התראות…</p>;
  if (!settings) return <p role="alert" className="rounded-xl border border-ink/10 bg-white p-4 text-sm text-ink/70">{message || 'הגדרות ההתראות אינן זמינות כרגע.'}</p>;

  return (
    <section className="space-y-4 rounded-2xl border border-ink/10 bg-white p-4 sm:p-5">
      <div>
        <p className="text-xs font-bold tracking-wide text-primary">התראות Push</p>
        <h2 className="mt-1 text-xl font-bold text-ink">שליטה בהתראות העסק</h2>
        <p className="mt-2 text-sm leading-6 text-ink/65">אפשר להפעיל או לכבות בנפרד את ההתראות למוכר ואת ההתראות שנשלחות ללקוחות. סוגי ההתראות עצמם מוגדרים במערכת.</p>
      </div>

      {!settings.entitled && (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">ערוץ Push אינו מאושר כרגע לעסק על ידי מנהל המערכת. ההעדפות הקיימות נשמרות, אך לא תישלחנה התראות.</p>
      )}
      {settings.entitled && !settings.configured && (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">הערוץ מאושר לעסק, אך שירות ההתראות עדיין לא הוגדר במערכת.</p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex items-start gap-3 rounded-xl border border-ink/10 p-3">
          <input type="checkbox" checked={settings.seller_enabled} disabled={saving || (!settings.entitled && !settings.seller_enabled)}
            onChange={(event) => void updatePreference('seller_enabled', event.target.checked)} className="mt-1 h-4 w-4 accent-primary" />
          <span>
            <span className="block text-sm font-bold">התראות למוכר</span>
            <span className="mt-1 block text-xs leading-5 text-ink/60">הזמנה חדשה באתר ובקשת הצטרפות לרשימת המתנה. אפשר לבחור אם לקבל את ההתראות האלה.</span>
          </span>
        </label>
        <label className="flex items-start gap-3 rounded-xl border border-ink/10 p-3">
          <input type="checkbox" checked={settings.customer_enabled} disabled={saving || (!settings.entitled && !settings.customer_enabled)}
            onChange={(event) => void updatePreference('customer_enabled', event.target.checked)} className="mt-1 h-4 w-4 accent-primary" />
          <span>
            <span className="block text-sm font-bold">התראות ללקוחות</span>
            <span className="mt-1 block text-xs leading-5 text-ink/60">שיבוץ תור מרשימת המתנה, עדכון או ביטול תור — רק ללקוחות שנתנו הסכמה.</span>
          </span>
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink/10 p-3">
        <div className="min-w-0">
          <p className="text-sm font-bold">התראות למוכר במכשיר הזה</p>
          <p className="mt-1 text-xs leading-5 text-ink/60">{deviceSubscribed ? 'המכשיר הזה מוגדר לקבלת התראות.' : permission === 'denied' ? 'ההרשאה חסומה בדפדפן. יש לאפשר התראות בהגדרות האתר.' : permission === 'unsupported' ? 'הדפדפן אינו תומך בהתראות במצב הנוכחי.' : 'אפשר להפעיל התראות במכשיר הזה.'}</p>
        </div>
        {deviceSubscribed ? (
          <button type="button" onClick={() => void disableThisDevice()} disabled={saving}
            className="min-h-10 rounded-full border border-ink/20 px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50">כיבוי במכשיר הזה</button>
        ) : permission === 'unsupported' ? null : (
          <button type="button" onClick={() => void enableThisDevice()} disabled={saving || !settings.seller_effective}
            className="min-h-10 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-fg disabled:opacity-50">הפעלת התראות במכשיר הזה</button>
        )}
      </div>
      {message && <p role="status" className="text-sm text-ink/70">{message}</p>}
    </section>
  );
}
