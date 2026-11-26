import type { ReactNode } from 'react';
import { StorefrontPushManagementFooter, StorefrontPushManagementProvider } from '@/components/StorefrontPushManagement';

type Props = {
  hasGallery: boolean;
  identity: ReactNode;
  gallery: ReactNode;
  services: ReactNode;
  catalog: ReactNode;
  contact: ReactNode;
  footer: ReactNode;
};

/** One shared storefront composition for every business category. */
export default function StorefrontPageComposition({ hasGallery, identity, gallery, services, catalog, contact, footer }: Props) {
  return (
    <StorefrontPushManagementProvider>
    <main id="storefront-main" tabIndex={-1} className="mx-auto max-w-6xl px-3 pb-28 pt-2 sm:px-6 sm:pb-10 sm:pt-4">
      <section className="storefront-universal-hero" data-has-gallery={hasGallery ? "true" : "false"} aria-label="פרטי העסק ותמונות העסק">
        {hasGallery && <div className="storefront-universal-hero-media">{gallery}</div>}
        <div className="storefront-universal-hero-copy">{identity}</div>
      </section>
      <div className="storefront-universal-content">
        {services}
        {catalog}
      </div>
      {contact}
      {footer}
      <StorefrontPushManagementFooter />
    </main>
    </StorefrontPushManagementProvider>
  );
}
