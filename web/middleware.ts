import { NextResponse, type NextRequest } from 'next/server';

function normalizeHost(value: string | undefined): string {
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
  const host = normalizeHost(
    req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? req.nextUrl.host,
  );
  if (!host || configuredPlatformHosts().has(host)) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = `/biz/_site${url.pathname === '/' ? '' : url.pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ['/((?!api/|_next/|manage/|biz/|favicon.ico).*)'],
};
