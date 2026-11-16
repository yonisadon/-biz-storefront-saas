# BTime Business Profile Adaptation — Implementation Plan

Status: planning only. No code, database, migration, tenant data, merge, or deployment changes are included.

## Phase 0 — Product decisions and code discovery

- Review and approve the initial category taxonomy in `business-category-matrix.md`.
- Confirm the distinction between business category and actual operating capabilities.
- Trace the complete `POST /api/admin/businesses` provisioning sequence, including registry writes, tenant database creation, tenant initialization, and any config-copy operation.
- Trace the exact seller business GET/PATCH routes, validation, authentication, and tenant DB selection.
- Trace how `ManageBusiness`, `PublicPayload`, config schema validation, and the public storefront are assembled.
- Identify all existing-tenant compatibility assumptions and current tests.
- Confirm where the public category should be consumed: server-side layout resolver, public payload, or both.

Exit criteria: a reviewed data-flow diagram and a final storage/API proposal, with all writes and copies identified.

## Phase 1 — Domain model and persistence

- Add stable category IDs and Hebrew labels in one shared, typed source of truth.
- Choose one canonical persistence location. If mirrored, define authoritative side and synchronization behavior.
- Extend validation and TypeScript types consistently.
- Keep category nullable for existing tenants; generic behavior remains unchanged when null.
- Add optional short description for `other` only if product approves.
- Add focused repository/API tests for valid IDs, invalid IDs, missing category, and legacy configs.
- If a migration is required, write an additive, reversible migration. Do not run it in production without explicit approval and a verified backup/rollback plan.

Exit criteria: category can be read and saved without changing any unrelated business configuration.

## Phase 2 — Provisioning form

- Add category selection to the existing `web/app/platform-admin/page.tsx` flow beside business identity fields.
- Keep current palette/theme/layout pickers unchanged and separate.
- Submit category with the existing `POST /api/admin/businesses` request.
- Extend request validation and initial tenant configuration creation without changing the existing branding payload or provisioning order.
- Confirm that provisioning failure/rollback behavior remains unchanged and that category data is consistent in the chosen canonical store.

Exit criteria: a newly provisioned test tenant has the selected category and the existing design configuration exactly as before.

## Phase 3 — Seller editing

- Add a business-category control to `web/components/manage/BusinessPanel.tsx`, not to `DesignPanel.tsx`.
- Use the existing business settings save flow where appropriate, but isolate category updates so they cannot overwrite name, contact, hours, order-flow, legal, or branding settings.
- On save, read latest server state and update only category-related keys.
- Preserve all existing profile address fields and all other configuration.
- Make category changes explicit, with a short explanation that existing data and visual preferences are not deleted or reset.

Exit criteria: seller can change category; persisted data diff contains only approved profile fields.

## Phase 4 — Adaptation resolver and public structure

- Implement a pure deterministic resolver with unit tests.
- Inputs: confirmed category, actual active products/services, booking modes, inquiry channels, and explicit seller overrides.
- Outputs: section order, emphasis, contextual labels, and an eligible primary action.
- Keep the existing public page as a safe fallback for unclassified businesses.
- Only render sections/actions backed by actual data and enabled capabilities.
- Do not change booking algorithms, appointment state transitions, availability, waitlist, CRM, WhatsApp semantics, or catalog CRUD.
- Keep all visual preferences independent. Category recommendations must not overwrite saved palette, theme, fonts, gallery or item layouts.
- Start with composable section-ordering/content-label adjustments, not a proliferation of fully separate page templates.

Exit criteria: category changes affect only the intended structure and labels; all existing booking and inquiry journeys pass regression tests.

## Phase 5 — Existing tenants and rollout

- Keep existing tenants unclassified initially; do not guess or silently backfill.
- Build a read-only suggestion based on real tenant configuration only after the signal mapping is tested.
- Ask the seller to confirm or correct the suggestion.
- Roll out behind a feature flag or to a small test cohort first.
- Test at least: nail studio, hair salon, treatment practice, appointment-based professional, jewelry/gift shop, mixed business, and an unclassified legacy tenant.
- Verify that category changes do not alter products, services, images, prices, schedules, appointments, blocked times, waitlist, CRM, legal text, domains, or design settings.

Exit criteria: no regressions, clear seller confirmation, and a tested fallback for all legacy tenants.

## Phase 6 — Release gate

Before merge or production:
- CI, lint, typecheck, build, unit and API tests pass.
- Provisioning tests cover new category creation and rollback.
- Tenant-isolation tests cover category read/write.
- Regression tests cover booking, availability, waitlist, CRM, WhatsApp, catalog, accessibility, RTL, and responsive layouts.
- Manual acceptance on mobile and desktop for each representative business category.
- Migration plan and rollback plan reviewed, if applicable.
- Update `SYSTEM_SPEC.md` with final implementation decisions and migration status.
- User explicitly approves merge to `main` and production deployment.

## Explicitly out of scope for the first release

- Food businesses.
- AI-driven automatic classification.
- Automatic conversion of service/product types.
- Automatic changes to booking rules, availability, hours, order flow, or payment behavior.
- Deleting, hiding, or rewriting existing business content on category changes.
- Replacing the current seller design system or forcing category-specific themes/palettes.
- Creating a separate seller onboarding system.
