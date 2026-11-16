# BTime Storefront Type & Adaptation Matrix

Status: approved first-release scope, 2026-11-16.

## First-release storefront types

The first release deliberately uses only two platform-level storefront types:

| ID | Hebrew label | Initial examples | Presentation emphasis |
|---|---|---|---|
| `products` | חנות מוצרים | תכשיטים, תכשירים/קוסמטיקה, מתנות, אביזרים ומוצרים דומים | Product discovery, strong product imagery, product details, prices and catalog |
| `services` | עסק שירותים | מספרות, ציפורניים, מכוני יופי, הצעות נישואין, בעלי מקצוע ושירותים נוספים | Service explanation, portfolio/work examples, duration/pricing when configured, contact and appointment options when enabled |

This is a deliberately broad first classification, not a complete profession taxonomy. Do not add food businesses in this initiative.

## Type is not capability

The selected type affects storefront presentation, content emphasis and suitable labels only. It does not restrict what a tenant can use.

Every business retains all existing BTime capabilities and configuration options. A business may have both products and services regardless of its selected storefront type. Actual item records, booking modes, availability, opening hours, order flow, WhatsApp, inquiry, CRM and waitlist settings determine which actions are available.

Never confuse `storefront_type` (`products` / `services`) with the existing operational `site_mode` (`catalog_order` / `services_whatsapp`). Do not infer one from the other or change either when the other changes.

## Provisioning and ownership

- The platform administrator selects one of the two types in the existing Super Admin create-business form.
- The selection is not editable by the seller in BusinessPanel or DesignPanel.
- Store the value as top-level `storefront_type` in the existing business config JSONB and seed it through the current provisioning/config-copy path.
- Do not add a separate registry column, table, seller control, or second onboarding flow.
- Existing tenants without the field remain unclassified and use the generic/legacy presentation. Do not infer or backfill a type from business name, products, or `site_mode`.

## Presentation contract

- Product stores should emphasize product imagery, product names/details and price/catalog discovery.
- Service businesses should emphasize service descriptions, professional/work imagery, durations/prices when configured, and the available contact or booking journey.
- The type may influence section hierarchy, visual emphasis, labels and default presentation.
- It must never hide existing content, disable a capability, or fabricate content/actions.
- Every action must be backed by actual tenant data and enabled configuration.
- Preserve explicit visual settings such as palette, font, theme, gallery layout and product/service layouts. The type must not overwrite those settings.
- Keep the existing public storefront as fallback for unclassified legacy tenants.

## Data preservation and regression boundaries

No change to the following when a storefront type is selected or used:
- products, services, item kinds, images, descriptions, details, prices or active states;
- booking modes, durations, opening hours, availability, blocked times, appointments or waitlist;
- order flow, site mode, WhatsApp, inquiry, CRM or lead history;
- legal text, domains, contact details, gallery or existing design preferences.

No SQL migration is required for the first implementation because the value is a property in the existing validated JSONB config.

## Acceptance examples

1. Product shop with jewelry and WhatsApp: product-led visual emphasis; existing WhatsApp flow remains exactly as configured.
2. Service business with bookable nail services: service-led emphasis and appointment action only if the service booking configuration supports it.
3. Service business without online booking: show services and configured contact/inquiry actions; do not invent booking.
4. Mixed business: both product and service items remain visible and usable, with no forced conversion.
5. Legacy tenant without a type: unchanged generic/legacy presentation.
