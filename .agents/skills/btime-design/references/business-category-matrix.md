# BTime Business Profile & Storefront Design Matrix

Status: approved direction, 2026-11-16.

## Core decision
BTime does not classify a business as either products or services. A business may sell products, provide services, or do both. The selected business profile determines the customer-facing design and information architecture. It never limits capabilities.

The Default / general BTime design is a permanent selectable option. It must preserve the existing general storefront and remain available after any profile is selected. Food businesses are out of scope.

## Initial profiles

| ID | Hebrew label | Examples | Design emphasis |
|---|---|---|---|
| default | עיצוב בסיסי (ברירת מחדל) | Any business without a specialized profile | Existing general BTime storefront, unchanged |
| nails | סטודיו לציפורניים | Manicure, gel polish, nail construction | Real work portfolio, nail-service menu, treatment details, prices/durations and appointment action when configured |
| hair_salon | מספרה | Haircut, color, styling, barber | Salon identity, real hair-work imagery, service hierarchy and appointment action when configured |
| beauty_institute | מכון יופי | Beauty treatments and cosmetology | Treatment-led presentation, real results/gallery where available, service details and booking/inquiry |
| treatment_professional | מטפל/ת ובעל/ת מקצוע | Appointment-based professionals and treatments | Clear explanation of services, practitioner identity, practical appointment/contact path |
| proposal_planning | הצעות נישואין והפקות | Marriage proposals and related experiences | Experience-led hero, real event gallery, packages/services and inquiry |
| jewelry | תכשיטים ושעונים | Jewelry stores and watch shops | Editorial product discovery, product imagery and details; configured services remain visible |
| gifts_cosmetics | מתנות וקוסמטיקה | Gifts, preparations, cosmetics and related products | Product discovery, collections only when supported by real data, imagery and details |
| other | עסק אחר | Business not represented above | Safe general presentation; no invented industry assumptions |

The profile list is extensible. Add a profile only when it has a distinct information architecture and concrete design specification.

## Ownership and selection
- The profile is selected during business setup.
- The seller can change the profile later from business settings.
- The seller can always choose default to return to the existing general design.
- Missing or unrecognized values resolve to default; never infer a profile from the business name or item kinds.
- A profile change is presentation-only.

## Profile is not operating model
The profile must not be conflated with product/service item kind, site_mode (catalog_order / services_whatsapp), booking mode, appointment duration, availability, opening hours, WhatsApp, site inquiry, CRM or waitlist settings.

Mixed businesses are first-class: show both products and services from actual tenant data. A profile may change emphasis and ordering, but may not hide or disable an existing item kind or enabled customer journey.

## Visual specification required before implementation
For each profile, document the visual concept, hero and primary action, section order, product/service/mixed presentation, gallery treatment, typography and palette compatibility, mobile/desktop RTL composition, empty/missing/long-content states, reusable components and seller preferences that remain effective.

A profile is not implemented if it only changes CSS colors, border radius or image aspect ratio. It must create a meaningful difference in composition and content hierarchy.

## Data and regression boundaries
Changing profile must not modify products/services, item kinds, media, descriptions, prices, booking, availability, appointments, waitlist, site mode, order flow, WhatsApp, inquiry, CRM, legal text, domains, gallery assets or branding preferences. Only the profile field may change.

## Acceptance examples
1. Nail studio: work imagery and configured nail services are prominent; booking appears only when supported by service configuration.
2. Hair salon: salon-specific composition; configured products remain available alongside services.
3. Jewelry shop: product-led composition; configured repair/consultation services remain visible.
4. Proposal planner: experience-led layout; real gallery and configured packages only.
5. Mixed business: both item kinds remain available and usable.
6. Switch any specialized profile to Default: existing general BTime presentation returns; no data or branding is lost.
7. Legacy tenant without a profile: unchanged general storefront.
