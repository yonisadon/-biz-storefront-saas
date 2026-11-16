# BTime Business Profile Adaptation — Architecture Proposal

Status: discovery and design proposal, 2026-11-16. No implementation or schema change is authorized by this document.

## 1. Existing flow to reuse

The current repository does not expose seller self-service tenant creation. The observed provisioning path is:

1. Platform operator opens `web/app/platform-admin/page.tsx`.
2. The form collects business name, slug, contact details, and visual branding.
3. It sends `POST /api/admin/businesses`.
4. `backend/src/routes/admin.ts` validates the request, creates the central business/tenant record, provisions the tenant database, and initializes the tenant.
5. The seller later edits business information in `web/components/manage/BusinessPanel.tsx` and visual preferences in `web/components/manage/DesignPanel.tsx`.

Therefore:
- Reuse the existing platform-admin provisioning form for the initial category selection. Place the field with the business identity fields, without creating a parallel setup flow.
- Keep the existing design picker and palette picker as they are. Category is not a replacement for design preferences.
- Add seller editing to the existing Business settings panel. Do not make the seller edit category through the Design panel.
- If seller self-service signup is added in the future, reuse the same category model and validation rather than creating a second taxonomy.

The distinction matters: the current code's creation form is operated by the platform administrator, while the seller can edit the business name and settings after provisioning.

## 2. Domain model

Keep three concepts separate:

### Business identity
Existing fields such as business name, slug, contact details, and about text.

### Business category
A stable, controlled identifier representing the professional domain, for example `beauty_personal_care`, `hair_and_barber`, or `jewelry_gifts_accessories`. The initial list is defined in `business-category-matrix.md` and remains provisional until approved.

Proposed profile metadata:
- `category_id`: controlled identifier; nullable for legacy/unclassified businesses.
- `category_description`: optional short free-text description, primarily useful for `other` or clarification.
- Optional `category_confirmed_at` / `category_source` metadata only if needed for safe migration and suggestions. Avoid storing redundant or speculative metadata.

Do not store the seller-facing label as the canonical value. Keep stable IDs and map them to Hebrew labels in application code.

### Operating model / capabilities
Do not make this a single manually selected enum that overrides real tenant configuration. Resolve actual capabilities from active products/services and existing configuration:
- active product items;
- active service items;
- supported booking modes and availability configuration;
- inquiry / WhatsApp / CRM configuration;
- quote-based pricing and related item settings.

The category can influence recommended content hierarchy and language. Actual data and enabled capabilities determine which sections and actions can be rendered.

If future product work needs seller overrides (for example, hide a section), model those as explicit presentation preferences, not as category or as a destructive conversion of operational data.

## 3. Data ownership and storage — decision still required

Current findings:
- `business_profile` already exists in tenant config but currently contains only `city`, `street_address`, and `show_address`.
- `backend/src/schema/business_config.schema.json` validates that profile object and currently rejects unknown properties.
- `web/lib/types.ts` exposes `business_profile` to the public payload with only address fields.
- Public storefront payload is built by `backend/src/routes/public.ts` from the tenant database.
- Tenant provisioning begins from central registry data and copies/initializes configuration in the tenant database.
- Seller Business settings and Design settings read the latest tenant configuration before saving, which helps preserve other panels' changes. The category update must follow the same safe partial-update principle.

Recommended direction for implementation:
- Keep the category logically within the business profile domain, but do not assume the current JSON field is automatically the correct persistence location.
- Trace the full seller business GET/PATCH handler and the central registry schema/provisioning copy before choosing the canonical source of truth.
- Prefer one canonical persisted value. If a value must be mirrored between central registry and tenant DB, define which side is authoritative, when synchronization occurs, how failures are retried, and how consistency is checked.
- Avoid two independently editable copies of the category.
- Add schema validation, TypeScript types, seller API validation, public payload typing, and tests together.
- Never rewrite the whole config from a stale UI snapshot. Fetch latest config server-side and update only the category-related keys in a transaction or equivalent atomic operation.

No final choice is made yet between a tenant config field, a normalized registry field, or a controlled mirrored representation. That choice requires inspection of the exact business management API and provisioning SQL/functions.

## 4. Safe category change contract

The category update should be a narrow operation:
- Validate the category ID against the approved allowlist.
- Update only the category/profile fields.
- Preserve all sibling keys in `business_profile` and all unrelated config sections.
- Do not update `site_mode`, `order_flow`, `branding`, catalog items, bookings, or schedules.
- Return the persisted business object/profile so the seller UI can refresh from server truth.
- Make retries idempotent.
- Log the old and new category IDs for operational audit if the existing audit/logging architecture supports it; do not log customer personal data.

Changing category must not trigger provisioning, tenant recreation, data migration of business records, or automatic booking-rule changes.

## 5. Adaptation resolver

Implement a deterministic resolver, separate from React rendering and separate from the seller's saved design settings.

Inputs:
- confirmed business category;
- actual tenant capabilities / catalog facts;
- explicit seller presentation overrides, if any;
- current visual preferences.

Outputs:
- recommended page structure / section order;
- section emphasis and labels;
- primary action candidate, validated against actual enabled customer actions;
- optional design/art-direction hints, never a forced theme or palette.

Resolution precedence:
1. Safety and real capability constraints: never render unavailable actions.
2. Explicit seller presentation overrides.
3. Category recommendations.
4. Existing generic BTime behavior as fallback.

The resolver must be deterministic and testable. It must not call an LLM at request time. AI classification, if later introduced, is an onboarding suggestion only and requires seller confirmation.

Do not initially generate new page templates for every category. Start with a small set of composable section/ordering profiles and content labels; add specialized sections only when a category has a proven need.

## 6. Compatibility and migration strategy

Existing tenants have no category field and must continue to render exactly as they do now until a category is explicitly selected or confirmed.

A safe rollout should:
1. Add nullable category support with a generic fallback.
2. Deploy read compatibility before writing new values.
3. Add category selection to new tenant provisioning.
4. Add seller editing for existing tenants.
5. Offer existing sellers a suggested category only after signals can be safely derived and reviewed.
6. Enable category-based structure gradually behind a feature flag or controlled rollout.
7. Never backfill a guessed category silently.

Whether this requires a tenant migration, registry migration, both, or neither depends on the final storage choice. Do not create or run a migration before that decision.

## 7. Non-functional requirements

- Strict tenant isolation: a category read/write must always use the authenticated tenant context.
- Validation: reject unknown IDs, malformed free text, and unexpected fields.
- Concurrency: category saves must not overwrite edits from another management panel.
- Observability: log category update failures and consistency errors without exposing tokens or personal customer data.
- Accessibility and RTL: Hebrew labels, keyboard operation, clear errors, responsive layout.
- Cache behavior: ensure public storefront revalidation reflects category changes; inspect current 30-second revalidation and API caching before deciding whether additional invalidation is needed.
- Security: category selection is not an authorization control. Never expose admin-only operations to seller routes.

## 8. Open architecture decisions before implementation

- Final category list and stable IDs.
- Whether free-text description is stored for all categories or only `other`.
- Canonical storage: tenant config, central registry, or a carefully defined mirrored model.
- Exact management API handler and authorization boundary for seller updates.
- Whether the category profile is included in public payload immediately or only consumed server-side for layout resolution.
- Feature-flag / rollout mechanism and fallback behavior.
- Whether any category-specific content labels require translation/localization beyond Hebrew.
