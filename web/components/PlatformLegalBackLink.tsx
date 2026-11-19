'use client';

import { useState } from 'react';

export default function PlatformLegalBackLink() {
  const [loading, setLoading] = useState(false);

  async function goBack() {
    if (loading) return;
    setLoading(true);

    const params = new URLSearchParams(window.location.search);
    const requested = params.get('returnTo') ?? '';
    const safeInternalPath = requested.startsWith('/')
      && !requested.startsWith('//')
      && !requested.includes('\\')
      && !requested.startsWith('/platform-legal');

    if (safeInternalPath) {
      window.location.replace(requested);
      return;
    }

    let destination = '/login';
    try {
      const response = await fetch('/api/auth/me', {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { 'Cache-Control': 'no-cache' },
      });
      const data = response.ok ? await response.json().catch(() => null) : null;
      if (data?.user?.role === 'super_admin') destination = '/platform-admin';
      else if (data?.user?.role === 'owner') destination = '/account';
    } catch {
      // A failed session lookup must never send the user to a protected page.
    }
    window.location.replace(destination);
  }

  return (
    <a
      href="/login"
      onClick={(event) => { event.preventDefault(); void goBack(); }}
      aria-busy={loading}
      className="text-sm font-semibold text-blue-700 underline"
    >
      חזרה ל-BTime
    </a>
  );
}
