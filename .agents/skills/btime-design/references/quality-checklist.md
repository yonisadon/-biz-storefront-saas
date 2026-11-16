# BTime Storefront Quality Checklist

Use this checklist for design reviews and before completing storefront UI changes. Mark an item as not applicable only when the corresponding feature is absent for the tenant or task.

## Visual quality

- [ ] The visual direction is grounded in the actual business category and assets.
- [ ] The result does not look like an unmodified generic SaaS template.
- [ ] Palette roles are consistent and contrast is sufficient.
- [ ] Typography has a clear hierarchy and Hebrew text renders naturally.
- [ ] The page has a clear focal point and useful content rhythm.
- [ ] Cards, borders, shadows, and rounded corners are used with restraint.
- [ ] Images have intentional crop/aspect ratio and are not stretched.
- [ ] No empty image area, awkward blank space, or unexplained oversized component.
- [ ] Long names, descriptions, prices, and detail values remain readable.

## Layout coverage

- [ ] Product and service layout settings are tested independently.
- [ ] `cards`, `gallery`, `list`, `carousel`, and `luxury_catalog` are checked when affected.
- [ ] Image-present and image-missing states are checked.
- [ ] One-item, many-item, mixed product/service, and empty states are checked as applicable.
- [ ] Hero gallery modes (`slider`, `thumbnails`) are checked when affected.
- [ ] All four themes are checked when shared theme CSS changes.

## Responsive and RTL

- [ ] Widths 320, 360, 375, 390, and 430 px have no horizontal overflow.
- [ ] Tablet and desktop composition remain intentional.
- [ ] Hebrew wraps naturally; no vertical text or one-word-per-line collapse.
- [ ] Mixed RTL/LTR content (phone, email, prices, Latin product names) remains ordered correctly.
- [ ] Images and cards do not stretch unexpectedly on narrow screens.
- [ ] Touch targets and sticky elements do not obscure content or actions.

## Functionality regression

- [ ] Product/service selection and quantity controls still work.
- [ ] Each cart line can be independently removed.
- [ ] Mixed carts retain the correct item names, prices, and quantities.
- [ ] Search and pagination do not lose selected cart items.
- [ ] Description/details expand and collapse correctly.
- [ ] WhatsApp links retain the correct item and business context.
- [ ] Site inquiry submission remains intact when applicable.
- [ ] Appointment date/time selection and server availability remain intact.
- [ ] Booking duration, calendar reservation, and waitlist behavior remain intact.
- [ ] Gallery swipe, navigation, thumbnails, and image enlargement work when present.
- [ ] Contact, social, opening-hours, and legal links remain correct.

## Accessibility

- [ ] All controls are keyboard reachable and have visible focus.
- [ ] Dialogs and overlays can be opened and closed without trapping focus.
- [ ] Buttons and inputs have accessible names and associated labels.
- [ ] Headings and landmarks are semantic and ordered.
- [ ] Text and controls have sufficient contrast in every tested palette.
- [ ] Selected, disabled, loading, error, and success states are perceivable.
- [ ] Reduced-motion preference is respected.
- [ ] Enlarged text and accessibility toolbar settings do not break the layout.
- [ ] Touch targets are sufficiently large.

## Engineering and verification

- [ ] The diff is limited to intended files.
- [ ] No tenant configuration fields were removed or silently reset.
- [ ] No backend, API, DB, or migration changes were introduced for a visual-only task.
- [ ] Relevant lint, build, and tests were run.
- [ ] Browser screenshots were inspected at mobile and desktop sizes when possible.
- [ ] Unverified checks are explicitly reported; no testing is claimed without evidence.
- [ ] No merge to `main` or production deployment occurred without explicit approval.


## Business-profile adaptation and data safety

- [ ] The selected business profile determines visual architecture, not product/service capability.
- [ ] Default always restores the existing general BTime storefront.
- [ ] Missing or legacy profiles resolve to Default; no name-based or silent classification.
- [ ] Profile-specific layouts have a documented concept, hero, section order, catalog/portfolio treatment and responsive RTL behavior.
- [ ] Profile differences are meaningful composition/hierarchy changes, not only CSS color or radius changes.
- [ ] Mixed businesses show both products and services.
- [ ] Actual enabled features and tenant data—not profile labels—control which actions are rendered.
- [ ] Seller palette, fonts and explicit design preferences remain independent and are not overwritten.
- [ ] Changing profile preserves all business, catalog, service, booking, schedule, appointment, waitlist, CRM, media, contact, legal, domain, branding and design data.
- [ ] Save operations update only the profile field and cannot overwrite unrelated tenant configuration.
