function normalizeHost(value: string | null | undefined): string {
  if (!value) return '';
  const first = value.split(',')[0].trim().toLowerCase();
  if (!first) return '';
  try {
    const url = new URL(first.includes('://') ? first : `https://${first}`);
    return url.hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return first.replace(/:\d+$/, '').replace(/\.$/, '');
  }
}

export function resolveRequestHost(headers: { get(name: string): string | null }): { host: string; isPlatform: boolean } {
  // Keep in sync with middleware.ts: only explicit platform hosts and the
  // per-deployment VERCEL_URL are platform-owned. The production/public URL
  // variables may refer to the custom domain itself.
  const platformValues = [
    process.env.PLATFORM_HOSTS ?? '',
    process.env.VERCEL_URL ?? '',
    'localhost',
    '127.0.0.1',
  ];
  const platformHosts = new Set(
    platformValues.flatMap((value) => value.split(',')).map(normalizeHost).filter(Boolean),
  );
  const candidates = [
    headers.get('x-original-host'),
    headers.get('x-vercel-forwarded-host'),
    headers.get('x-forwarded-host'),
    headers.get('host'),
  ].map(normalizeHost).filter(Boolean);
  const host = candidates.find((candidate) => !platformHosts.has(candidate)) ?? candidates[0] ?? '';
  return { host, isPlatform: Boolean(host) && platformHosts.has(host) };
}
