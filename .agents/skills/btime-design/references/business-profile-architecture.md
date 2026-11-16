# BTime Storefront Type — Architecture

Status: approved first-release architecture, 2026-11-16.

## Existing flow to reuse

The current repository provisions tenants through the platform administrator:
1. `web/app/platform-admin/page.tsx` collects business identity and base visual settings.
2. It sends `POST /api/admin/businesses`.
3. `backend/src/routes/admin.ts` validates the request, creates the central business, provisions the dedicated tenant DB, and initializes the tenant.
4. The initial business config is copied from the registry business record into the tenant database.
5. The seller later edits business details in `BusinessPanel.tsx` and seller-editable visual settings in `DesignPanel.tsx`.

Use this exact provisioning path. Do not create a new onboarding flow.

## Approved domain model

The first release has exactly two broad storefront types:
- `products`: product shops such as jewelry, preparations/cosmetics, gifts and accessories.
- `services`: service businesses such as hair salons, nail studios, beauty institutes, proposal planning and other professional services.

The type is a platform-level presentation choice. It is not a business capability or an item-kind restriction. All existing BTime features remain available according to their own settings and actual tenant data.

## Ownership and persistence

- The platform administrator selects `storefront_type` in the existing Super Admin provisioning form.
- Sellers cannot edit this value. Do not add it to BusinessPanel or DesignPanel.
- Persist it as a top-level property in the existing business config JSONB.
- The existing provisioning process already copies config to the tenant DB. No separate registry column, table, sync process or migration is needed.
- Extend `backend/src/schema/business_config.schema.json` with an optional enum property. It is optional to preserve existing tenants.
- The public API exposes the validated value as `storefront_type: 'products' | 'services' | null`.
- Missing/invalid legacy values resolve to `null` and use the existing generic presentation. Do not guess or backfill.

## Keep operational settings independent

The existing `site_mode` is an operational setting (`catalog_order` / `services_whatsapp`). It is not the storefront type and must never be repurposed.

Do not modify:
- item kinds or the ability to have both products and services;
- booking modes, appointment durations, availability, opening hours or blocked times;
- appointments, waitlist, CRM leads or customer data;
- WhatsApp, inquiry, order flow, quote settings or catalog behavior;
- domains, legal text, seller contact information or design settings.

The category influences only presentation: content emphasis, section hierarchy, labels and CSS/design hooks. It must not hide content or create actions unsupported by real data and enabled settings.

## Existing design system

The current palette, theme, font, gallery layout, product layout, service layout and title color remain independent controls in the existing design system. The storefront type can influence the presentation layer but must not overwrite those stored values. The seller's existing design panel and save behavior remain unchanged.

## Public rendering

The public backend reads tenant config from the tenant DB and adds the normalized `storefront_type` to the public payload. The Next.js storefront uses the value as a presentation hook, while all operational behavior continues to be driven by current catalog data and configuration.

Start with composable visual/content emphasis rather than creating separate page templates for every profession. Keep the generic path for legacy tenants.

## Validation and tests

- Super Admin request must accept only `products` or `services`.
- New provisioning stores the selected value in the initial config copied into the tenant DB.
- Config validation accepts the optional field and rejects unsupported values.
- Public payload returns the two valid values or null.
- Seller API and seller UI are not extended with this field.
- Tests must confirm `site_mode`, branding, item kinds, booking rules and other config remain unchanged.
