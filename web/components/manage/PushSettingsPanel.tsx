'use client';

import { useCallback, useEffect, useState } from 'react';
import { mcall } from '@/lib/manageApi';

type Settings = {
  entitled: boolean;
  configured: boolean;
  public_key: string | null;
  seller_enabled: boolean;
  customer_enabled: boolean;
  seller_effective: boolean;
  customer_effective: boolean;
  seller_devices: number;
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

  const load = useCallback(async () => {
    try {
      const value = await mcall<Settings>(token, 'push/settings');
      setSettings(value);
    } catch {
      setMessage('לא הצלחנו לטעון את הגדרות ההתראות.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

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
    setSaving(true);
    setMessage('');
    try {
      if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('unsupported');
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('permission');
      const registration = await navigator.serviceWorker.register('/sw.js');
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey(settings.public_key),
        });
      }
      const json = subscription.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new Error('subscription');
      await mcall(token, 'push/subscriptions', {
        method: 'POST',
        body: JSON.stringify({ subscription: { endpoint: json.endpoint, keys: json.keys } }),
      });
      await load();
      setMessage('המכשיר הזה נרשם לקבלת התראות מהמוכר.');
    } catch (error) {
      const reason = error instanceof Error ? error.message : '';
      setMessage(reason === 'permission'
        ? 'לא ניתנה הרשאה להתראות. אפשר לשנות זאת בהגדרות הדפדפן.'
        : reason === 'unsupported'
          ? 'הדפדפן אינו תומך בהתראות Push במצב הנוכחי.'
          : 'לא הצלחנו לרשום את המכשיר. נסו שוב.');
    } finally {
      setSaving(false);
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
        const endpoint = subscription.endpoint;
        await mcall(token, 'push/subscriptions', {
          method: 'DELETE',
          body: JSON.stringify({ endpoint }),
        });
      }
      await load();
      setMessage('המכשיר הוסר מהתראות למוכר. הרשאת הדפדפן נשארת זמינה להתראות לקוחות שאושרו בנפרד.');
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
        <p className="mt-2 text-sm leading-6 text-ink/65">ההגדרות כאן נפרדות מהרשאת ההתראות של הדפדפן. אפשר להפעיל או לכבות התראות למוכר וללקוחות בנפרד.</p>
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
            <span className="mt-1 block text-xs leading-5 text-ink/60">הזמנה חדשה באתר ובקשת הצטרפות לרשימת המתנה.</span>
          </span>
        </label>
        <label className="flex items-start gap-3 rounded-xl border border-ink/10 p-3">
          <input type="checkbox" checked={settings.customer_enabled} disabled={saving || (!settings.entitled && !settings.customer_enabled)}
            onChange={(event) => void updatePreference('customer_enabled', event.target.checked)} className="mt-1 h-4 w-4 accent-primary" />
          <span>
            <span className="block text-sm font-bold">התראות ללקוחות</span>
            <span className="mt-1 block text-xs leading-5 text-ink/60">עדכון או ביטול תור, רק ללקוח שהסכים לקבל התראות עבור אותה הזמנה.</span>
          </span>
        </label>
      </div>

      <div className="rounded-xl border border-ink/10 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-bold">המכשיר הנוכחי</p>
            <p className="mt-1 text-xs text-ink/60">{settings.seller_devices} מכשירים רשומים להתראות למוכר.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void enableThisDevice()} disabled={saving || !settings.seller_effective}
              className="min-h-10 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-fg disabled:opacity-50">רישום מכשיר זה</button>
            <button type="button" onClick={() => void disableThisDevice()} disabled={saving}
              className="min-h-10 rounded-full border border-ink/20 px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50">הסרת מכשיר זה</button>
          </div>
        </div>
        <p className="mt-2 text-xs leading-5 text-ink/55">כדי לקבל התראות, יש לאשר גם את הרשאת הדפדפן. כיבוי התראות למוכר אינו מבטל הרשאות דפדפן ואינו פוגע בהסכמות לקוח נפרדות.</p>
      </div>
      {message && <p role="status" className="text-sm text-ink/70">{message}</p>}
    </section>
  );
}
