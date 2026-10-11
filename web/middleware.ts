import { NextResponse, type NextRequest } from 'next/server';
const PLATFORM_HOSTS = (process.env.PLATFORM_HOSTS ?? 'localhost')
  .split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
export function middleware(req: NextRequest) {
  const host = (req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '')
    .split(',')[0].trim().toLowerCase().replace(/:\d+$/, '');
  if (!host || PLATFORM_HOSTS.includes(host)) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = `/biz/_site${url.pathname === '/' ? '' : url.pathname}`;
  return NextResponse.rewrite(url);
}
export const config = {
  matcher: ['/((?!api/|_next/|manage/|biz/|favicon.ico).*)'],
};