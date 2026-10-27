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
  const values = [
    process.env.PLATFORM_HOSTS ?? '',
    process.env.VERCEL_URL ?? '',
    process.env.VERCEL_PROJECT_PRODUCTION_URL ?? '',
    process.env.NEXT_PUBLIC_PLATFORM_URL ?? '',
    process.env.PUBLIC_BASE_URL ?? '',
    'localhost',
    '127.0.0.1',
  ];
  return new Set(values.flatMap((value) => value.split(',')).map(normalizeHost).filter(Boolean));
}

export function middleware(req: NextRequest) {
  const platformHosts = configuredPlatformHosts();

  // Prefer the actual Host header, but if a proxy supplies a platform hostname
  // there, use a non-platform forwarded host so a customer domain still reaches
  // its storefront. Never trust incoming x-original-host: overwrite it below.
  const candidates = [
    req.headers.get('host'),
    req.headers.get('x-forwarded-host'),
    req.nextUrl.host,
  ].map(normalizeHost).filter(Boolean);

  const host = candidates.find((candidate) => !platformHosts.has(candidate))
    ?? candidates[0]
    ?? '';

  // Fail closed when no usable hostname is available. Only known platform hosts
  // may fall through to the platform app (including /platform-admin).
  if (!host) return new NextResponse('Not Found', { status: 404 });
  if (platformHosts.has(host)) return NextResponse.next();

  // Every non-platform hostname is treated as a public storefront host.
  // Unknown/unverified domains are rejected by the /api/site tenant resolver;
  // they must never fall back to the platform home or super-admin page.
  const url = req.nextUrl.clone();
  url.pathname = `/biz/_site${url.pathname === '/' ? '' : url.pathname}`;

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-original-host', host);
  return NextResponse.rewrite(url, { request: { headers: requestHeaders } });
}

export const config = {
  matcher: ['/((?!api/|_next/|manage/|biz/|favicon.ico).*)'],
};
