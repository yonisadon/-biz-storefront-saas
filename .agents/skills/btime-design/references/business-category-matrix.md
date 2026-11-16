# BTime Business Category & Adaptation Matrix

Status: working product specification, 2026-11-16. This is an initial taxonomy for review, not a locked list of all future verticals.

## Scope

The first adaptation initiative prioritizes businesses whose customer journey is based on appointments, treatments, services, and professional work. Product shops remain supported, with emphasis on jewelry, gifts, accessories, and similar goods. Food businesses are explicitly out of scope for this initiative.

A business may combine services and products. Do not force a mixed business into one mutually exclusive operating mode.

## Two independent dimensions

### A. Business category — what kind of business is this?

| Category ID (provisional) | Seller-facing label | Examples | Likely content emphasis |
|---|---|---|---|
| `beauty_personal_care` | יופי, טיפוח וקוסמטיקה | ציפורניים, קוסמטיקאית, טיפולי יופי | Services, appointment booking, treatment details, work gallery |
| `hair_and_barber` | מספרות ועיצוב שיער | מספרה, ספר/ית, עיצוב שיער | Services, durations/prices, portfolio, appointment booking |
| `wellness_treatments` | טיפולים ורווחה | רפלקסולוגיה, עיסוי, טיפולים משלימים | Treatment descriptions, practitioner information, appointment booking |
| `appointment_professional` | בעלי מקצוע מבוססי פגישות | ייעוץ מקצועי, שיעורים פרטיים, פגישות ושירותים מתואמים | Clear service explanation, meeting/appointment request, contact |
| `professional_services` | שירותים ובעלי מקצוע | צילום, תיקונים, שירותים לבית ולעסק, שירותים לפי הצעת מחיר | Portfolio or examples, service scope, inquiry/quote, contact |
| `jewelry_gifts_accessories` | תכשיטים, מתנות ואביזרים | תכשיטים, שעונים, מתנות, אביזרים | Product imagery, product details, catalog and inquiry/order |
| `mixed_business` | עסק משולב | Business with both meaningful service and product activity | Distinct service and product sections; both journeys remain available |
| `other` | תחום אחר | A business that does not fit the options | Neutral structure based on actual capabilities and content |

Category IDs are provisional. Before implementation, confirm the exact labels, examples, and whether any rows should be merged or split. Do not add food categories in this initiative.

### B. Operating model — what can the customer actually do?

The operating model is not the same as the category. It must be derived from, and validated against, the tenant's real configuration and data.

| Capability / model | Evidence in current product | Possible customer journey |
|---|---|---|
| Appointment-based service | Active service items and supported booking mode / availability configuration | Select service, choose available date/time, submit booking |
| Service inquiry / coordination | Service items and enabled inquiry or WhatsApp channel | Read service details and contact the business |
| Product catalog | Active product items | Browse product details and inquire/order through enabled flow |
| Quote-based service | Service or product configured for quote rather than fixed price | Review scope and request a quote |
| Combined services + products | Both active service and product items | Separate, clearly labelled sections and supported actions |

Do not infer that all businesses in a category support appointments. For example, a beauty professional may accept inquiries only, while another business in the same category may have live appointment availability.

Do not use the existing `site_mode` as a substitute for business category. It is an existing operational setting (`catalog_order` / `services_whatsapp`) and its meaning must remain unchanged.

## Adaptation matrix

This matrix describes recommended defaults, not hard constraints. The public page must only render sections supported by actual tenant content and enabled capabilities.

| Category | Recommended first emphasis | Useful sections when data exists | Main action when supported |
|---|---|---|---|
| Beauty / personal care | Services and booking | Work gallery, treatment details, duration, price, practitioner/about | קביעת תור |
| Hair / barber | Services and booking | Haircut/color services, portfolio, duration, price, opening hours | קביעת תור |
| Wellness / treatments | Treatment information and booking | Practitioner/about, treatment explanation, duration, price, location | קביעת טיפול |
| Appointment professional | Explain the service and make scheduling clear | Meeting types, duration, professional profile, FAQs/about if supplied | קביעת פגישה / יצירת קשר |
| Professional services | Explain scope and establish trust | Portfolio, service areas, service details, quote/inquiry | קבלת פרטים / בקשת הצעת מחיר |
| Jewelry / gifts / accessories | Product catalog and product discovery | Product gallery, specifications, prices, categories if supported | בירור לגבי מוצר / הזמנה |
| Mixed business | Clear separation of service and product journeys | Services, products, portfolio, booking and contact as applicable | Contextual action per section |
| Other | Neutral, data-led structure | Only meaningful sections backed by data | Action based on enabled capabilities |

## Detection and confirmation rules

### New businesses
- Add explicit category selection to the existing business provisioning form; do not create a second onboarding flow.
- The person provisioning the tenant selects the initial category. The current code path is the platform-admin creation form; it is not currently a seller self-service signup flow.
- Offer an `other` option and an optional short business description.
- Business name may be used to display contextual examples or help the operator choose, but must not be the sole classifier or silently set the category.
- The category is editable by the seller later in the existing Business settings area.

### Existing businesses
- Do not silently assign or change categories.
- A future suggestion can consider actual configured signals: active product/service items, booking modes, appointment settings, inquiry channels, and existing business description.
- A suggestion must be reviewable and explicitly confirmed by the seller. If signals conflict or are insufficient, show an unclassified / other state and ask the seller.
- AI is optional future assistance. It may propose a category, never silently save one.

## Data and preference preservation

Changing the category:
- Changes only the business profile category and any explicitly accepted category-based recommendations.
- Must not delete, convert, reset, or rewrite products, services, images, descriptions, prices, booking modes, opening hours, availability, appointments, blocked times, waitlist entries, CRM leads, contact channels, legal text, domains, branding, or seller visual preferences.
- Must not silently change `site_mode`, `order_flow`, booking rules, item `kind`, or booking modes.
- Must not hide existing content by default. Any future category-specific visibility controls need a separate explicit seller action and a separate specification.
- Must preserve seller-selected palette, font, theme, gallery layout, product layout, service layout, and title color.
- Category-based defaults should only fill unset values or be offered as a preview. They must not overwrite a seller's explicit choices.

## Acceptance examples

1. A nail studio selects beauty/personal care and has active bookable services: the site emphasizes services and appointment booking, while retaining the seller's chosen colors and theme.
2. A hair salon has services but no configured online availability: show services and the configured contact/inquiry path; do not invent a booking calendar.
3. A reflexology practice has bookable treatments: emphasize treatment descriptions and appointment selection; do not claim medical capabilities or create unsupported health content.
4. A jewelry shop has products and WhatsApp inquiries: emphasize product images/details and the existing inquiry route; do not show appointment controls.
5. A mixed business has both products and bookable services: retain both journeys and make their distinction clear.
6. A seller changes category: all existing data and explicit visual preferences remain unchanged; only the category profile and approved recommendations may change.
