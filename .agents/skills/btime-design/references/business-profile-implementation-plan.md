# BTime Storefront Type — Implementation Plan

Status: implementation in progress on `docs/btime-design-skill`, 2026-11-16.

## Phase 1 — Platform-admin selection and persistence

- Add a required two-choice selector to the existing Super Admin create-business form: `products` or `services`.
- Send `storefront_type` in the existing provisioning request.
- Validate the enum in `backend/src/routes/admin.ts`.
- Seed it in the existing business config JSONB so the existing provisioning copy places it in the tenant DB.
- Extend the business config JSON schema. No SQL migration or new registry field/table.

## Phase 2 — Public API and rendering

- Expose the normalized value from the tenant config in the public payload.
- Add the corresponding TypeScript public-payload type.
- Add a root-level storefront presentation attribute and category-specific visual emphasis.
- Keep existing content and functionality data-driven. Do not disable or hide capabilities.
- Keep `site_mode`, booking, waitlist, CRM, WhatsApp and catalog behavior untouched.

## Phase 3 — Compatibility and regression

- Existing tenants with no `storefront_type` remain unclassified and use the current generic rendering.
- Do not backfill inferred values.
- Do not add a seller edit control or change seller save flows.
- Preserve branding and all tenant data.

## Phase 4 — Automated validation

- Run repository CI, lint, typecheck, build and relevant tests.
- Review the exact diff for accidental changes to operational settings.
- Fix all CI/test failures before asking for final acceptance.

## Phase 5 — Final representative-business acceptance

Only after implementation and automated validation are complete, test representative product and service businesses on mobile and desktop. Include:
- product shop (jewelry/preparations/gifts);
- service business (hair/nails/beauty);
- service business with and without online booking;
- mixed product + service catalog;
- legacy unclassified tenant.

Verify that all current features continue to work and that no data is hidden, reset or rewritten.

## Release gate

Update `SYSTEM_SPEC.md` with the verified implementation and test status. Keep the PR as draft until the user reviews it. Do not merge to `main`, run migrations or deploy without explicit user approval.

## Explicitly out of scope

- Additional subcategories/profession-specific taxonomy.
- Seller editing of storefront type.
- Food businesses.
- AI classification or automatic backfill.
- New SQL tables/columns/migrations.
- Any change to booking, availability, waitlist, CRM, WhatsApp, order flow, catalog CRUD or payment behavior.
