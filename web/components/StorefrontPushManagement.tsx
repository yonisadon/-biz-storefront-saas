'use client';

import { useStorefrontTranslation } from '@/components/StorefrontLanguageProvider';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

type PushManagementEntry = {
  active: boolean;
  status: string | null;
  onCancel: () => void;
};

type PushManagementContextValue = {
  entry: PushManagementEntry | null;
  register: (entry: PushManagementEntry | null) => void;
};

const PushManagementContext = createContext<PushManagementContextValue | null>(null);

export function StorefrontPushManagementProvider({ children }: { children: ReactNode }) {
  const [entry, setEntry] = useState<PushManagementEntry | null>(null);
  const register = useCallback((next: PushManagementEntry | null) => setEntry(next), []);
  const value = useMemo(() => ({ entry, register }), [entry, register]);

  return <PushManagementContext.Provider value={value}>{children}</PushManagementContext.Provider>;
}

export function useStorefrontPushManagement(
  enabled: boolean,
  active: boolean,
  status: string | null,
  onCancel: () => void,
) {
  const register = useContext(PushManagementContext)?.register;

  useEffect(() => {
    if (!register || !enabled) return;
    register({ active, status, onCancel });
    return () => register(null);
  }, [register, enabled, active, status, onCancel]);
}

export function StorefrontPushManagementFooter() {
  const t = useStorefrontTranslation();
  const entry = useContext(PushManagementContext)?.entry;
  if (!entry || (!entry.active && !entry.status)) return null;

  return (
    <div className="mt-6 border-t border-ink/10 pt-3 text-center">
      {entry.active && (
        <button type="button" onClick={entry.onCancel} className="text-xs text-ink/55 underline underline-offset-2">
          {t('pushCancel')}
        </button>
      )}
      {entry.status && <p role="status" className="mt-2 text-xs text-ink/55">{entry.status}</p>}
    </div>
  );
}
