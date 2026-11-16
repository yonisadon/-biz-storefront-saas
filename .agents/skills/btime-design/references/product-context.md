# BTime Product Context

## Product identity
BTime is a Hebrew-first, multi-tenant SaaS platform focused primarily on service businesses, appointments, treatments, and professionals. It also supports product-oriented shops such as jewelry, gifts, accessories, and similar goods, as well as businesses that combine products and services. Food businesses are outside the scope of the current business-profile initiative.

Each business has a customer-facing public page and a seller management area. The public storefront should help customers understand the business and complete the relevant journey—especially discovering a service and booking an appointment where supported.

## Business profile: category and operating model
Keep two independent dimensions:

1. **Business category**: the professional domain, selected explicitly by the seller during business setup and editable later. Initial category families should prioritize beauty/personal care, hair, treatment/wellness, appointment-based professionals, other professional services, jewelry/gifts/product shops, mixed businesses, and "other". This is a working taxonomy, not a final locked list.
2. **Operating model**: what the business actually offers and how customers interact: appointment-based services, service inquiry/quote, product catalog, or a combination.

The category informs language, content hierarchy, relevant sections, and visual/art-direction recommendations. The operating model and actual tenant configuration determine which capabilities and actions can be shown. Never assume that every business in one category has identical booking rules or enabled features.

## Detection and onboarding
- New businesses: ask the seller to select a category during setup; provide "other" and a short free-text description. Do not classify solely from the business name.
- Existing businesses: derive a suggested profile from real configured data—products, services, booking modes, availability, and inquiry channels—and ask the seller to confirm it. Treat ambiguous or conflicting evidence as unknown/neutral, not as permission to change the tenant.
- AI classification is optional future assistance only. It must propose, not silently apply, a category.
- The seller can change the category later.

## Adaptive storefront behavior
Business category and operating model should influence site structure: section order, emphasis on services/products, portfolio/gallery, professional information, service details, and appointment actions. Only show sections and actions supported by real data and enabled tenant capabilities. Never add fake content or empty placeholders.

Seller visual preferences remain independent and editable: palette, theme, font, hero gallery layout, product layout, service layout, and title color. A category must not force one visual template or overwrite explicit visual choices.

## Mandatory data preservation on category changes
Changing the business category must not delete, convert, reset, or rewrite existing business details, products, services, images, descriptions, prices, booking modes, opening hours, availability, appointments, blocked times, waitlist entries, CRM leads, contact channels, legal text, domains, branding, or visual preferences.

Do not infer permission to change item types, booking modes, schedules, or appointment workflows. Save only the category/profile fields. If existing content is less relevant under the new category, retain it; any public visibility changes must be explicitly designed and reviewed separately.

## Primary customer experience
Depending on actual tenant data and configuration, the public page can include:
- Business identity and description.
- Hero/gallery or professional portfolio imagery.
- Services and/or products.
- Prices, durations, or quote-based pricing.
- Additional item details and descriptions.
- Contact details, social links, location, and opening hours.
- WhatsApp or site inquiry actions.
- Appointment date/time selection and server-managed availability.
- Waitlist entry where enabled.
- Legal and accessibility information and the accessibility toolbar.

Render only meaningful content and supported actions.

## Seller experience
Sellers configure business profile and customer-facing design separately. Existing design settings include palette, storefront theme, hero gallery layout, product layout, service layout, font style, and business title color. Preserve this separation and avoid overwriting unrelated configuration during saves.

## Product principles
- Appointment/service journeys are the primary focus of the current initiative.
- Product shops such as jewelry and gifts remain supported.
- Mobile-first, polished customer experience.
- Real business content over demo content.
- Distinctive identity grounded in business category and actual assets.
- Hebrew RTL quality and accessibility across all states.
- Existing booking, inquiry, waitlist, catalog, and CRM behavior must remain intact.

## Architecture boundaries
- Frontend: Next.js 15 and React 19 under `web/`.
- Backend: Node/TypeScript under `backend/`.
- PostgreSQL with separate tenant databases and a central registry.
- Public storefront route: `web/app/biz/[slug]/page.tsx`.
- Seller management UI: `web/components/manage/`.
- Tenant-specific storefront styles are scoped under `.brand-root`.

For a visual-only task, do not change backend contracts, database schema, tenant provisioning, migrations, or booking logic. Business-profile adaptation is a functional/product initiative and requires a separate architecture review before implementation.
