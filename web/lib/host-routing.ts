function normalizeHost(value: string | null | undefined): string {
  if (!value) return '';
  const first = value.split(',')[0].trim().toLowerCase();
  if (!first) return '';
  try {
    const url = new URL(first.includes('://') ? first : `https://${first}`);
    return url.hostname.toLowerCase().replace(/\\.$/, '');
  } catch {
    return first.replace(/:\\d+$/, '').replace(/\\.$/, '');
  }
}

export function resolveRequestHost(headers: { get(name: string): string | null }): { host: string; isPlatform: boolean } {
  const platformValues = [
    process.env.PLATFORM_HOSTS ?? '',
    process.env.VERCEL_URL ?? '',
    process.env.VERCEL_PROJECT_PRODUCTION_URL ?? '',
    process.env.NEXT_PUBLIC_PLATFORM_URL ?? '',
    process.env.PUBLIC_BASE_URL ?? '',
    'localhost',
    '127.0.0.1',
  ];
  const platformHosts = new Set(
    platformValues.flatMap((value) => value.split(',')).map(normalizeHost).filter(Boolean),
  );
  const candidates = [
    headers.get('host'),
    headers.get('x-forwarded-host'),
  ].map(normalizeHost).filter(Boolean);
  const host = candidates.find((candidate) => !platformHosts.has(candidate)) ?? candidates[0] ?? '';
  return { host, isPlatform: Boolean(host) && platformHosts.has(host) };
}
