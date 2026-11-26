'use client';

import PwaInstallButton from '@/components/PwaInstallButton';
import { useStorefrontTranslation } from '@/components/StorefrontLanguageProvider';

export default function StorefrontPwaInstallButton() {
  const t = useStorefrontTranslation();
  return <PwaInstallButton label={t('pwaInstall')} translate={t} compact />;
}
