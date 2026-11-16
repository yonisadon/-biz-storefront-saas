# Storefront Rendering Architecture Audit

Date: 2026-11-16  
Branch: `docs/btime-design-skill`  
Scope: read-only architecture analysis for the storefront design experiment. No application code, API, database, tenant data, booking behavior or production environment changed.

## Executive finding

The current storefront is **profile-aware but not yet profile-composed**. The public page still has one largely shared page skeleton. Profiles influence some ordering, labels, a special nails gallery and CSS selectors, but most of the page's visual hierarchy and markup are shared. This creates a ceiling: a profile can look different in details while retaining the same underlying template.

The most important constraint is not that BTime has business rules. Those rules can remain stable while the presentation tree changes. The constraint is that several large components currently own both behavior and their rendered markup, especially the catalog/booking section.

## Evidence in the current branch

| Area | Current implementation | Confirmed observation |
|---|---|---|
| Public route and data | `web/app/biz/[slug]/page.tsx` | Fetches tenant storefront data and legal docs, normalizes saved layouts, computes contact/CTA state and renders the whole public page. |
| Page composition | Same file | One shared intro/header, gallery region, service-mode section or catalog section, contact section and footer. The profile does not select a separate page composition. |
| Profile branching | Same file | Service-led profiles change item ordering and some CTA/heading decisions. Nails gets a dedicated gallery component; most other profiles retain the shared gallery. |
| Catalog and booking | `web/components/OrderSection.tsx` | A large client component owns catalog search/pagination, selection/cart snapshots, appointment availability, booking steps, waitlist and submission behavior alongside item presentation. |
| Service-mode rendering | Same file | The WhatsApp-only mode renders a separate item list directly in the page, while the regular catalog mode uses `OrderSection`. This creates two presentation paths for similar product/service data. |
| Gallery | `StorefrontGallery.tsx`, `NailPortfolioGallery.tsx` | Shared gallery and a nails-specific gallery have separate markup/interaction implementations. Both consume the selected tenant images and hero selection. |
| Item imagery | `StorefrontItemImage.tsx` | Owns image selection/lightbox behavior; visual treatment is coupled to its own markup. |
| Seller controls | `StorefrontDesignPicker.tsx`, `DesignPanel.tsx` | Theme, independent product/service layouts and hero-gallery mode are explicit saved settings. These must remain effective. |
| Theme tokens | `web/lib/theme.ts`, `web/lib/palettes.ts` | Tenant color values are exposed as CSS variables at the `.brand-root` boundary. |
| Styling | `web/app/globals.css` | Profile-specific presentation is currently largely expressed as global CSS scoped by `data-storefront-profile`, including a large nails block. |

## Confirmed architectural limitations

### 1. One shared page skeleton

The profile attribute currently changes selected decisions, but the overall page structure remains the same. The hero remains a centered shared header in JSX; the profile-specific asymmetric layout is attempted through CSS. The section containers are also shared. This means art direction is trying to overcome a fixed composition.

### 2. CSS is carrying too much structural responsibility

Profile styles in `globals.css` target shared selectors such as `.storefront-intro`, `.storefront-hero`, `#catalog-section`, `#services-section`, `.storefront-items-list` and `.storefront-card`. This is convenient for a first experiment, but it makes the design dependent on the existing DOM and on selector precedence. It also makes it harder to reason about profile-specific page architecture.

### 3. Functional and visual responsibilities are coupled

`OrderSection` contains important behavior that must not be rewritten casually: search, pagination, selected item snapshots, cart, appointment date/time, server availability, booking, waitlist and submission. It also owns the catalog item's presentation. A new profile design therefore cannot safely replace the component wholesale, but it also should not be forced to keep all of its current markup.

### 4. Two item-rendering paths exist

The regular catalog path is inside `OrderSection`; the WhatsApp service-mode path is rendered directly in the public page. A visual system that changes only one path will produce inconsistent business experiences. Both paths need a shared presentation contract while retaining their different actions and capabilities.

### 5. Seller choices are real constraints

The public page resolves legacy `grid` to `cards`, and passes separate product and service layouts to the catalog. Gallery mode and selected hero image are passed to the gallery. Tenant palette and font/theme attributes are attached at the root. A profile redesign must use these settings rather than silently overriding them.

## What is not a blocker

- The fact that booking, availability and WhatsApp behavior are shared does not require the visual layout to remain shared.
- The fact that tenant data comes from one public API does not require every profile to use one page composition.
- The default BTime page can remain the unchanged fallback while specialized profiles use different presentation components.
- Existing product/service records can be passed unchanged into profile-specific visual components.

## Recommended target architecture

Keep the current route as a **data and behavior orchestrator**, not the place where every profile's visual structure is hard-coded.

1. **Storefront page orchestration** — fetch data, normalize safe values, calculate enabled capabilities and pass a typed view model. Keep this layer visually thin.
2. **Profile composition layer** — a resolver selects Default or a specialized composition component (for example, `DefaultStorefront`, `NailsStorefront`, `ProposalStorefront`, `RetailStorefront`). Each owns page-level hierarchy, section order, hero composition and responsive layout.
3. **Shared presentation primitives** — business identity, CTA group, portfolio/gallery frame, service menu, product list, contact details and legal footer. They accept data and explicit callbacks; they do not invent business content.
4. **Behavioral modules** — preserve booking/cart/search/availability/waitlist and inquiry logic. Where needed, separate the functional controller from the visual item/section renderer incrementally. Keep the same validated actions and state transitions.
5. **Seller preference adapter** — maps saved palette/font/theme/layout/gallery settings to presentation tokens and component props. No hidden profile override.
6. **Profile-scoped styles** — styles belong to the composition or component that owns the design. Keep tenant CSS variables and RTL semantics; avoid growing a single global selector block for every profile.

### Safe incremental seam

Do not rewrite `OrderSection` as a first step. First extract or define its **item presentation boundary** while leaving its search/cart/booking state and handlers in place. The presentation receives the actual item, selected state, quantity, price/details and existing action callbacks. The same presentation contract can later be used by the WhatsApp-only path, with only the actions that are actually enabled.

Then introduce one profile composition at a time. Default continues to render the existing composition. Nails becomes the first specialized composition and can be evaluated against real Noy tenant content. This is a presentation refactor only; no new API or persistence field is required.

## Wetori / Tori reference handling

The supplied URL is `https://www.wetori.co.il/start`. It is a competitor/product reference relevant to branded appointment storefronts. The available evidence from the supplied start page and the previously surfaced product visuals suggests useful areas to study: branded business identity, clear service choice with price/duration, customer booking flow and mobile-first presentation.

**Evidence limitation:** the supplied URL is a marketing/start page, not proof of every screen in the live customer booking flow or seller dashboard. Do not treat inaccessible or unverified product screens as inspected. If a specific in-app flow is needed later, use a public demo or screenshots supplied by the user. Do not copy Tori's brand, assets, text or exact UI.

## Implementation boundaries

Allowed in this experiment:
- Reorganize public page composition and extract presentation components.
- Introduce typed presentation props/view models.
- Separate visual rendering from existing behavior incrementally.
- Add profile-specific responsive composition and component-scoped styling.
- Keep Default as the existing unchanged baseline.

Not allowed without a separate decision:
- Changes to API contracts, backend, database, migrations or tenant configuration schema.
- Changes to booking, availability, cart, waitlist, WhatsApp, inquiry, CRM or contact behavior.
- Changing saved palette, font, theme, layout, gallery mode or selected images.
- Changing tenant data or using seller admin save flows against production-backed data.
- Merging, promoting or deploying to production.

## Verification still required before implementation acceptance

- Actual rendered screenshots at mobile widths 320, 360, 375, 390 and 430 px, plus tablet and desktop.
- Real Noy tenant content with no writes.
- Both catalog and WhatsApp-only service-mode presentation paths.
- Each supported service/product layout, gallery mode and all four themes as applicable.
- Missing images, long service names/descriptions, one item, multiple items and mixed products/services.
- Regression of selection/cart, appointment availability, booking, waitlist, WhatsApp/inquiry and accessibility behavior.
- A reviewed diff proving no backend/API/DB/data changes.

## Decision

The current Quiet Atelier CSS experiment is useful as a design probe, but it does not yet solve the architecture problem. Do not keep polishing it through additional CSS overrides. The next implementation should first establish the profile composition boundary and the shared item presentation contract, then rebuild the Nails page composition on that foundation. Keep this audit experimental; do not update `SYSTEM_SPEC.md` or the production design baseline.
