'use client';

import AccessibilityToolbar from '@/components/AccessibilityToolbar';
import { useStorefrontTranslation } from '@/components/StorefrontLanguageProvider';

export default function StorefrontAccessibilityToolbar({ statementHref }: { statementHref?: string }) {
  const t = useStorefrontTranslation();
  return <AccessibilityToolbar statementHref={statementHref} translate={t} />;
}
