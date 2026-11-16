# Existing BTime Design System

This document records the design system observed in the repository. Always verify current source before implementation; update this reference when product decisions or code change.

## Tenant branding

- `web/lib/palettes.ts` defines six palette presets: `lavender`, `rose`, `natural`, `luxury`, `blue`, and `minimal`.
- Palette roles are `primary`, `secondary`, `accent`, `background`, and `text`.
- `web/lib/theme.ts` converts valid tenant colors into CSS custom properties such as `--brand-primary` and derives a readable foreground for the primary color.
- The public storefront root uses `.brand-root`; tenant styles should remain scoped to it.

## Theme and typography settings

- Storefront themes: `soft`, `flat`, `editorial`, `creative`.
- Font settings: `modern`, `rounded`, `elegant`, `warm`.
- Business title color: `brand` or `black`.
- Current CSS font mapping is Hebrew-oriented and uses local/system font stacks with Heebo, Rubik, Assistant, and Frank Ruhl Libre. Verify actual font loading and fallback behavior before changing typography.
- Do not add external font downloads or new font packages without explicit approval.

## Layout settings

- Hero gallery: `slider` or `thumbnails`.
- Product layout and service layout are saved independently.
- Supported current layout values in the backend schema: `cards`, `gallery`, `list`, `grid`, `carousel`, `luxury_catalog`.
- The seller-facing picker currently exposes `cards`, `gallery`, `list`, `carousel`, and `luxury_catalog`; it does not expose `grid`.
- Legacy `grid` settings are mapped to `cards` in the public storefront page. Do not present `grid` as a live selectable choice unless the product owner explicitly changes that decision.
- Item layouts must be checked both with images and without images, and with products, services, or mixed catalogs.

## Key source files

| Concern | Source |
|---|---|
| Tenant palette presets | `web/lib/palettes.ts` |
| Tenant CSS variable generation | `web/lib/theme.ts` |
| Global and storefront CSS | `web/app/globals.css` |
| Public storefront page | `web/app/biz/[slug]/page.tsx` |
| Seller design panel | `web/components/manage/DesignPanel.tsx` |
| Seller theme/layout picker | `web/components/StorefrontDesignPicker.tsx` |
| Palette picker | `web/components/PalettePicker.tsx` |
| Catalog and booking interactions | `web/components/OrderSection.tsx` |
| Hero gallery | `web/components/StorefrontGallery.tsx` |
| Product/service image gallery | `web/components/StorefrontItemImage.tsx` |
| Accessibility controls | `web/components/AccessibilityToolbar.tsx` |
| Public data types | `web/lib/types.ts` |
| Backend config validation | `backend/src/routes/admin.ts`, `backend/src/schema/business_config.schema.json` |
| Theme config tests | `backend/tests/storefrontThemeConfig.test.ts` |
| Product decisions and rollout constraints | `SYSTEM_SPEC.md` |

## Styling constraints

- The public storefront uses tenant CSS variables through `.brand-root`.
- Typography is selected with the `data-font-style` attribute on the storefront root.
- Business title color is controlled separately with `data-business-title-color`.
- Theme and layout behavior is distributed across the public page, shared components, and CSS. Trace all three layers before making a change.
- Avoid duplicating rules or appending broad overrides at the end of `globals.css` without understanding the cascade and specificity.
- Preserve focus-visible styling and reduced-motion behavior.
- Do not assume every component responds to the theme attribute. Verify its actual selectors and visual output.
