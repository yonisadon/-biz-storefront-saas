# BTime Business Profile — Implementation Plan

Status: approved direction; implementation sequence for the current draft PR.

## Product contract
A business may offer products, services or both. The business profile selects the storefront's visual information architecture; it does not select capabilities. The existing general storefront remains permanently available as default.

The seller can select/change the profile and independently manage business content and supported branding preferences. Switching profiles never deletes or rewrites tenant data.

## Phase 1 — Correct the model and preserve compatibility
- Replace the misleading products/services classification with business profiles: default, nails, hair_salon, beauty_institute, treatment_professional, proposal_planning, jewelry, gifts_cosmetics and other.
- Make default the safe initial value for new and legacy businesses.
- Add seller profile selection in BusinessPanel.
- Keep operational site_mode separate.
- Update only the profile field when saving; preserve latest config and unrelated settings.
- Inspect existing storefront_type usage and do not auto-classify tenants carrying products/services values.

## Phase 2 — Define visual systems before coding
Create a design spec for each profile: concept, hero and primary action, section hierarchy, product/service/mixed item presentation, gallery, typography and palette compatibility, mobile/desktop RTL, empty/missing/long-content states.
The Default spec is the current general storefront captured as a baseline. Do not redesign it.

## Phase 3 — Implement real profile-specific composition
Recommended order: nails, hair salon, jewelry, proposal planning, beauty institute/treatment professional, gifts/cosmetics and other.
A profile must change composition and information hierarchy, not merely CSS decoration. Reuse existing data and action handlers. Never fabricate content or imagery.

## Phase 4 — Verification
- Backend schema/API tests for every profile ID, missing/unknown fallback and legacy config.
- Seller change-profile test proving unrelated config is preserved.
- Public rendering tests for each profile.
- Mixed product/service tests.
- Default visual regression against existing storefront.
- Booking, availability, WhatsApp, inquiry, CRM, waitlist and legal/accessibility regression checks.
- RTL responsive review at 320, 360, 375, 390, 430 px, tablet and desktop.
- Missing-image, one-item, many-item, long-name and empty-section checks.
- Web lint/build and backend tests; inspect Preview screenshots where available.

## Release boundaries
Keep work on the existing draft PR/branch. Do not merge to main, deploy to production, write production tenant data or run migrations without explicit approval. No migration unless verified schema constraints make it necessary and the user approves.
