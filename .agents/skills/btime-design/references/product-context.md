# BTime Product Context for Storefront Design

BTime is a Hebrew-first, multi-tenant platform for customer-facing business websites, product/service catalogs, inquiries and appointment management. It supports service professionals, appointment businesses, product shops and mixed businesses. Food businesses are outside the scope of the current business-profile initiative.

## Business profile and operating capabilities

A business profile describes the professional domain and selects the storefront design. It is not a products/services switch. A single tenant may offer both.

Initial profiles:
- default — existing general BTime storefront.
- nails — nail studios.
- hair_salon — hair salons and barbers.
- beauty_institute — beauty institutes and cosmetology.
- treatment_professional — appointment-based treatment professionals and other suitable practitioners.
- proposal_planning — marriage proposals and related event experiences.
- jewelry — jewelry and watch shops.
- gifts_cosmetics — gifts, preparations, cosmetics and similar product retail.
- other — safe neutral presentation.

Default is a permanent explicit choice. New tenants start with Default unless a specific profile is selected. Existing tenants without a profile remain on Default. Sellers can change the profile later and return to Default at any time.

The operating capabilities are determined only by actual tenant data and independent settings: product/service records, booking modes, availability, opening hours, WhatsApp, inquiry, order flow, CRM and waitlist. Never infer capabilities from the profile.

## Seller control

Sellers control business identity, description, products, services, images, prices, durations, contact information, and supported branding preferences such as palette and typography. The profile controls the presentation architecture; saved colors/fonts and other explicit preferences must not be overwritten when the profile changes.

## Required design behavior

A profile must create a recognizable difference in composition and information hierarchy, not merely a color, border-radius or image-ratio change.

- Nails: work portfolio and visual proof are central; configured treatments/services and booking options are easy to discover.
- Hair salon: haircut/color/styling portfolio and service menu are central; appointment path is prominent when enabled.
- Beauty institute: treatment families and real work imagery are prioritized; service details and appointment path follow the actual data.
- Treatment professional: clear professional identity, concise explanation of services, trust through real business information, and direct booking/inquiry path.
- Proposal planning: experience-led hero and real event gallery; packages and inquiry are prominent only when configured.
- Jewelry: editorial product presentation and product details; configured services remain accessible.
- Gifts/cosmetics: clear product discovery and catalog presentation; collections/categories only if supported by actual data.
- Default and Other: preserve the general BTime design without assuming an industry.

## Data and rendering rules

- Never invent testimonials, ratings, work examples, package names, prices, credentials or business details.
- Do not render empty sections or actions without valid destinations.
- Mixed businesses must show both product and service records.
- Appointment actions appear only when the relevant service configuration supports the action.
- A profile change updates only the profile field and preserves all unrelated tenant configuration.
- Legacy businesses with no profile use Default; do not classify them from names or catalog records.

## Existing implementation landmarks

- Public storefront: web/app/biz/[slug]/page.tsx.
- Catalog cards and customer selection: web/components/OrderSection.tsx.
- Seller business settings: web/components/manage/BusinessPanel.tsx.
- Seller visual preferences: web/components/manage/DesignPanel.tsx.
- Public typography and styling: web/app/globals.css.
- Public payload and types: backend/src/routes/public.ts and web/lib/types.ts.
- Profile matrix and architecture: references/business-category-matrix.md and references/business-profile-architecture.md.
