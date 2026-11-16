# BTime Product Context

## Product identity

BTime is a Hebrew-first, multi-tenant SaaS platform for business storefronts and appointment management. Each business has a customer-facing public page and a seller management area. The public storefront is designed to help customers understand the business, browse products or services, and contact or book with minimal friction.

The platform serves different business types. A storefront may be:
- Product-led (catalog and inquiry/order flow).
- Service-led (service presentation and WhatsApp inquiries).
- Mixed (products and services together).
- Appointment-led (services with free date/time requests or server-managed availability).

Do not assume all tenants have the same content, imagery, booking needs, or customer journey.

## Primary customer experience

The public page can include:
- Business identity and description.
- Hero/gallery imagery.
- Products and/or services.
- Prices or quote-based pricing.
- Additional item details and descriptions.
- Contact details, social links, location, and opening hours.
- WhatsApp or site inquiry actions.
- Appointment date/time selection and availability.
- Legal and accessibility information.
- Accessibility toolbar.

The exact sections depend on tenant data and configuration. Render only meaningful content; avoid empty sections and fake filler.

## Seller experience

Sellers can configure business details and customer-facing design separately. Design settings include palette, storefront theme, hero gallery layout, product layout, service layout, font style, and business title color. Preserve this separation and avoid overwriting unrelated configuration during saves.

## Product principles

- Mobile-first, polished customer experience.
- Real business content over demo content.
- Distinctive visual identity appropriate to the business category.
- Clear hierarchy and quiet, restrained interactions.
- Hebrew RTL quality across all page states.
- Accessible controls and responsive layouts.
- Existing booking, inquiry, and catalog behavior must remain intact.

## Architecture boundaries

- Frontend: Next.js 15 and React 19 under `web/`.
- Backend: Node/TypeScript under `backend/`.
- PostgreSQL with separate tenant databases and a central registry.
- Public storefront route: `web/app/biz/[slug]/page.tsx`.
- Seller management UI: `web/components/manage/`.
- Tenant-specific storefront styles are scoped under `.brand-root`.

For a visual-only task, do not change backend contracts, database schema, tenant provisioning, migrations, or booking logic.
