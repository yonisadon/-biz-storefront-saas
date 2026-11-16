# BTime Business Profile — Architecture

Status: approved direction, 2026-11-16.

## Existing flow to reuse
1. Platform admin creates a tenant in web/app/platform-admin/page.tsx.
2. POST /api/admin/businesses is handled in backend/src/routes/admin.ts.
3. Tenant config is validated by backend/src/schema/business_config.schema.json.
4. Public business data is assembled in backend/src/routes/public.ts.
5. The public storefront is rendered in web/app/biz/[slug]/page.tsx and shared components.
6. Seller business settings are edited in web/components/manage/BusinessPanel.tsx; visual preferences are in DesignPanel.tsx.

Extend these paths; do not create a parallel onboarding or storefront system.

## Domain model
Replace the broad products/services concept with one business profile:
default, nails, hair_salon, beauty_institute, treatment_professional, proposal_planning, jewelry, gifts_cosmetics, other.

This field is presentation metadata only. It must not infer item kinds, booking behavior, order flow, CRM, WhatsApp or any other operating capability. Missing or unknown values resolve to default.

## Ownership
- Initial profile can be selected during Super Admin provisioning; default is the initial value.
- Seller can change the profile later in BusinessPanel.
- Seller can always switch back to default.
- Seller palette/font/branding settings remain independent and preserved.

## Persistence and compatibility
Inspect all uses of the existing storefront_type field before changing it. Prefer one canonical profile field, but do not leave competing fields. Existing tenants with products/services values must use default until an explicit profile choice; never auto-classify them. Preserve old values during a compatibility period only if needed to avoid API breakage.

Seller updates must be partial and concurrency-safe: fetch latest config, update only the profile property, preserve unrelated fields, and validate allowed profile IDs server-side.

No database migration is expected because config is JSONB, but verify central and tenant validation and provisioning copies before recording that conclusion.

## Public rendering
Pass the normalized profile to the public storefront root as a stable data attribute or typed property. Keep the existing general storefront markup/styles as the default implementation. Add profile-specific composition in focused components/slots rather than piling on broad CSS selectors.

Profile components must consume the same product/service records and action handlers as the general storefront. Mixed businesses must remain fully supported. Profile-specific emphasis may reorder or style sections but may not suppress existing item kinds or enabled customer journeys.

## Design implementation sequence
1. Map current page composition and identify shared sections/actions.
2. Produce a visual spec for each profile, with Default as the baseline.
3. Implement one profile at a time, beginning with nails and hair salon, then jewelry and proposal planning, followed by beauty/treatment and gifts/cosmetics.
4. Build shared primitives where real patterns repeat; avoid one monolithic conditional page.
5. Add responsive RTL and content-state tests.
6. Verify switching profiles in both directions and preserving branding/settings.

## Non-goals
No payment flow, no product/service conversion, no automatic profile inference, no food profile, and no database redesign unless verified evidence requires it.
