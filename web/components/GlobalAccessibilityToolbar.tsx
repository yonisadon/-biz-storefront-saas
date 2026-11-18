'use client';

import { usePathname } from 'next/navigation';
import AccessibilityToolbar from '@/components/AccessibilityToolbar';

export default function GlobalAccessibilityToolbar() {
  const pathname = usePathname();
  if (pathname.startsWith('/biz/')) return null;
  return <AccessibilityToolbar statementHref="/platform-legal#accessibility_statement" />;
}
