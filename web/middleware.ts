import { NextResponse, type NextRequest } from 'next/server';

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

function configuredPlatformHosts(): Set<string> {
  // PLATFORM_HOSTS is the explicit source of truth for platform-owned hosts.
  // Do not classify VERCEL_PROJECT_PRODUCTION_URL, NEXT_PUBLIC_PLATFORM_URL or
  // PUBLIC_BASE_URL as platform hosts: Vercel may set/configure these to the
  // custom production domain, which would incorrectly route that domain to
  // /platform-admin instead of the tenant storefront.
  const values = [
    process.env.PLATFORM_HOSTS ?? '',
    process.env.VERCEL_URL ?? '',
    'localhost',
    '127.0.0.1',
  ];
  return new Set(values.flatMap((value) => value.split(',')).map(normalizeHost).filter(Boolean));
}

export function middleware(req: NextRequest) {
  const platformHosts = configuredPlatformHosts();

  // Vercel/proxies may expose the original customer hostname separately from
  // the internal Host. Consider all host headers, then choose a non-platform
  // hostname whenever one is present. Never trust incoming x-original-host.
  const candidates = [
    req.headers.get('x-vercel-forwarded-host'),
    req.headers.get('x-forwarded-host'),
    req.headers.get('host'),
    req.nextUrl.host,
  ].map(normalizeHost).filter(Boolean);

  const host = candidates.find((candidate) => !platformHosts.has(candidate))
    ?? candidates[0]
    ?? '';

  if (!host) return new NextResponse('Not Found', { status: 404 });
  if (platformHosts.has(host)) return NextResponse.next();

  // Non-platform hosts must resolve through the verified tenant-by-domain API.
  const url = req.nextUrl.clone();
  url.pathname = `/biz/_site${url.pathname === '/' ? '' : url.pathname}`;

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-original-host', host);
  return NextResponse.rewrite(url, { request: { headers: requestHeaders } });
}

export const config = {
  matcher: ['/((?!api/|_next/|manage/|biz/|favicon.ico).*)'],
};
