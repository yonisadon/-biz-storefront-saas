import type { ReactNode } from 'react';

type Props = {
  profile: string;
  hasGallery: boolean;
  identity: ReactNode;
  gallery: ReactNode;
  services: ReactNode;
  catalog: ReactNode;
  contact: ReactNode;
  footer: ReactNode;
};

/**
 * Profile-level information architecture. Slots contain the existing validated
 * tenant content and behavior; this component owns only their composition.
 * The default profile intentionally preserves the existing page order.
 */
export default function StorefrontPageComposition({
  profile,
  hasGallery,
  identity,
  gallery,
  services,
  catalog,
  contact,
  footer,
}: Props) {
  const isNails = profile === 'nails';

  return (
    <main
      id="storefront-main"
      tabIndex={-1}
      data-page-composition={isNails ? 'nails-editorial' : 'default'}
      className={`mx-auto max-w-6xl px-3 pb-28 sm:px-6 sm:pb-10 ${isNails ? 'pt-2 sm:pt-4' : 'pt-3 sm:pt-6'}`}
    >
      {isNails ? (
        <section className="nails-profile-hero" aria-label="העסק ותיק העבודות">
          <div className="nails-profile-hero-media">{gallery}</div>
          <div className="nails-profile-hero-copy">{identity}</div>
        </section>
      ) : (
        <div className="storefront-intro" data-has-gallery={hasGallery ? 'true' : 'false'}>
          {identity}
          {gallery}
        </div>
      )}
      <div className={isNails ? 'storefront-profile-content nails-profile-content' : undefined}>
        {services}
        {catalog}
      </div>
      {contact}
      {footer}
    </main>
  );
}
