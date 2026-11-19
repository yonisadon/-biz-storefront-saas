'use client';

import { usePathname } from 'next/navigation';
import AccessibilityToolbar from '@/components/AccessibilityToolbar';

export default function GlobalAccessibilityToolbar() {
  const pathname = usePathname();
  if (pathname.startsWith('/biz/')) return null;
  const returnTo = pathname && !pathname.startsWith('/platform-legal')
    ? `?returnTo=${encodeURIComponent(pathname)}`
    : '';
  return <AccessibilityToolbar statementHref={`/platform-legal${returnTo}#accessibility_statement`} />;
}
