'use client';

import { useCallback, useEffect, useState } from 'react';
import { mcallWithTimeout } from '@/lib/manageApi';
import { usePlatformLanguage } from '@/components/PlatformLanguageProvider';

type Status = {
  configured: boolean;
  connected: boolean;
  google_email: string | null;
  connected_at: string | null;
  last_sync_at: string | null;
  last_error: string | null;
  pending: number;
  failed: number;
};

export default function GoogleCalendarPanel({ token }: { token: string }) {
  const { language, t } = usePlatformLanguage();
  const locale = language === 'he' ? 'he-IL' : language === 'ru' ? 'ru-RU' : 'en-US';
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const current = await mcallWithTimeout<Status>(token, 'google-calendar/status');
      setStatus(current);
      if (current.configured && current.connected && current.pending > 0) {
        try {
          await mcallWithTimeout(token, 'google-calendar/sync', { method: 'POST' });
          setStatus(await mcallWithTimeout<Status>(token, 'google-calendar/status'));
        } catch {
          setError(t('googleSyncPending'));
        }
      }
    } catch {
      setError(t('googleStatusFailed'));
    }
  }, [token, t]);

  useEffect(() => { void load(); }, [load]);

  async function connect() {
    setBusy(true); setError(null);
    try {
      const result = await mcallWithTimeout<{ authorization_url: string }>(token, 'google-calendar/connect', { method: 'POST' });
      window.location.assign(result.authorization_url);
    } catch {
      setError(t('googleConnectFailed'));
      setBusy(false);
    }
  }

  async function sync() {
    setBusy(true); setError(null); setMessage(null);
    try {
      const result = await mcallWithTimeout<{ processed: number; failed: number; pending: number }>(token, 'google-calendar/sync', { method: 'POST' });
      setMessage(`${t('googleSyncSuccess')}: ${result.processed} ${t('eventsUpdated')}, ${result.failed} ${t('eventsFailed')}, ${result.pending} ${t('eventsPending')}.`);
      await load();
    } catch {
      setError(t('googleSyncFailed'));
    } finally { setBusy(false); }
  }

  async function disconnect() {
    if (!confirm(t('disconnectGoogleConfirm'))) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      await mcallWithTimeout(token, 'google-calendar/disconnect', { method: 'POST' });
      setMessage(t('googleDisconnected'));
      await load();
    } catch {
      setError(t('googleDisconnectFailed'));
    } finally { setBusy(false); }
  }

  return (
    <section dir={language === "he" ? "rtl" : "ltr"} className="mb-4 rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-bold">{t('googleCalendarTitle')}</h2>
          <p className="mt-1 text-sm text-gray-600">{t('googleCalendarDescription')}</p>
        </div>
        {status?.connected && <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-semibold text-green-800">{t('connected')}</span>}
      </div>
      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {message && <p role="status" className="mt-3 rounded-lg bg-blue-50 p-3 text-sm text-blue-900">{message}</p>}
      {!status && !error && <p className="mt-3 text-sm text-gray-500">{t('loadingConnection')}</p>}
      {status && !status.configured && (
        <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          {t('googleNotConfigured')}
        </p>
      )}
      {status?.configured && !status.connected && (
        <div className="mt-3">
          <p className="text-sm text-gray-600">{t('googleNotConnected')}</p>
          <button type="button" disabled={busy} onClick={() => void connect()} className="mt-3 min-h-10 rounded-full bg-gray-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? t('connecting') : t('connectGoogle')}
          </button>
        </div>
      )}
      {status?.connected && (
        <div className="mt-3 space-y-2">
          <p className="text-sm"><span className="font-semibold">{t('account')}:</span> <span dir="ltr">{status.google_email}</span></p>
          <p className="text-sm text-gray-600">{t('waiting')}: {status.pending} · {t('failed')}: {status.failed}</p>
          {status.last_sync_at && <p className="text-xs text-gray-500">{t('lastSync')}: {new Date(status.last_sync_at).toLocaleString(locale)}</p>}
          {status.last_error && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{t('lastSyncError')}: {t('genericApiError')}</p>}
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" disabled={busy} onClick={() => void sync()} className="min-h-10 rounded-full bg-gray-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {busy ? t('syncing') : t('syncNow')}
            </button>
            <button type="button" disabled={busy} onClick={() => void disconnect()} className="min-h-10 rounded-full border border-gray-300 px-4 py-2 text-sm">
              {t('disconnectGoogle')}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
