# BTime Business Profile — Visual Design Specifications

Status: design direction for implementation; visual acceptance still required.

## Shared principles

All profiles use the same tenant data, existing customer actions and shared accessibility/RTL foundations. Profile differences are expressed through page composition, hierarchy, section order, image treatment and component arrangement. Seller-selected palette and typography remain active. No profile may invent content or suppress a configured product, service or capability.

Default is the existing general BTime storefront exactly as the baseline. It is always selectable.

## Default — existing general storefront

- Preserve current intro/hero, gallery, catalog/order section, contact information and legal footer.
- Keep existing section order, card behavior, selection/cart and action flows.
- No profile-specific decoration or content assumptions.
- Switching to Default restores this structure without changing saved tenant settings.

## Nails — studio portfolio

**Concept:** a visual nail-art studio where the work is the strongest proof of quality, while service selection and booking remain immediately practical.

**Page hierarchy:**
1. Compact studio identity: business name, short description and a primary configured action.
2. Work gallery/portfolio immediately after the intro, with image-led presentation and captions when provided.
3. Nail services menu: service name, duration and price where configured; booking controls remain the existing BTime controls.
4. Optional retail products in a distinct secondary section when the business actually has products.
5. Business details/contact and legal footer.

**Composition:** mobile-first image gallery with carefully cropped portrait/square work photos; services should be easy to scan without forcing a long catalog of tall cards. Use the seller's chosen palette as accents, not as a replacement for the imagery. Avoid generic beauty stock motifs and invented before/after results.

## Hair salon — style portfolio

**Concept:** a contemporary salon identity with strong visual evidence of hair work and a clear route to the right treatment.

**Page hierarchy:**
1. Salon identity and primary appointment/contact action.
2. Portfolio/gallery emphasizing real haircut, color and styling work.
3. Services grouped by the actual configured catalog; no invented categories.
4. Optional products section when product records exist.
5. Business details/contact and legal footer.

**Composition:** editorial split/offset hero on desktop where assets permit; on mobile, title and action first, then gallery. Service cards should prioritize service name, description, duration and price without crowding. Maintain clear separation between product and service items in mixed businesses.

## Beauty institute — treatment-led presentation

**Concept:** organized treatment discovery, balancing visual results with clear explanations and practical booking.

**Page hierarchy:**
1. Institute identity and main action.
2. Treatment portfolio/gallery if real images exist.
3. Configured treatments/services with details and booking availability.
4. Optional product catalog.
5. Contact, address/hours and legal footer.

**Composition:** on desktop, place the institute identity beside its real treatment imagery, then give the configured treatment menu the full content width beneath them. On mobile, stack identity, gallery and treatments. Use calm structured sections and clear treatment names/details; avoid medical claims, credentials or results that are not provided by the business. If no gallery exists, the identity and treatment menu must close the gap naturally.

## Treatment professional — personal professional service

**Concept:** clarity and trust through the professional's real description, services and contact details rather than decorative retail design.

**Page hierarchy:**
1. Professional identity, description and primary configured action.
2. Service/treatment explanation and practical booking path.
3. Optional portfolio/gallery and products only when real data exists.
4. Hours/location/contact and legal footer.

**Composition:** typography-led, spacious but compact, readable service descriptions. On desktop, pair the professional identity with the configured service menu in a two-column opening; place any real portfolio/gallery after the service path. On mobile, stack identity, services and then gallery. No invented credentials, certifications, reviews or treatment promises.

## Proposal planning — experience-led business

**Concept:** sell the experience through real event imagery and configured packages, not a generic product grid.

**Page hierarchy:**
1. Large visual introduction with business name, actual about text and configured inquiry action.
2. Event gallery/portfolio with captions where available.
3. Configured packages/services with details and prices when provided.
4. Optional related products only when configured.
5. Contact details and legal footer.

**Composition:** a spacious, centered experience introduction followed by a wide real-event gallery, then configured packages/services in a narrower reading column. Mobile keeps the inquiry action visible early and uses a single-column flow. Do not fabricate packages, testimonials, event locations or sample prices.

## Jewelry and watches — editorial product shop

**Concept:** let product photography, craftsmanship and details carry the experience.

**Page hierarchy:**
1. Brand identity with concise description and catalog entry point.
2. Product catalog with product imagery and useful details.
3. Gallery/brand imagery if the business has real portfolio assets.
4. Configured services (such as repair or consultation) remain visible in a separate service grouping.
5. Contact and legal footer.

**Composition:** product-led editorial opening: identity beside the live product catalog on desktop, then any real gallery below the catalog; mobile stacks identity, catalog and gallery. Use consistent image ratios and no forced tall card text. Product details and prices are easy to scan. Preserve product selection, cart, WhatsApp and other existing actions.

## Gifts and cosmetics — discovery-led retail

**Concept:** approachable product discovery with clear product names, imagery, prices and details.

**Page hierarchy:**
1. Business identity and catalog action.
2. Product catalog, with actual categories only if the data model supports them.
3. Optional gallery/brand content.
4. Configured services remain visible if the business offers them.
5. Contact and legal footer.

**Composition:** discovery-led sequence: concise identity, product catalog, optional real gallery, then contact. Keep product cards flexible for missing images and long names. Do not create fake collections or category chips.

## Other

Use Default unless the actual business content clearly supports a safe, separately documented presentation. Never infer a niche from a name alone.


## First implementation refinement — nails and hair salon

These two service-led profiles are the first acceptance targets. The public catalog must place configured services before products for these profiles, without hiding products or changing item records. The hero action should jump directly to the service group when services exist. In WhatsApp presentation mode, the same service-first ordering and section anchor apply.

### Nails studio — composition details
- Keep the identity compact and centered; the portfolio heading and real gallery form the visual proof immediately below it.
- Use a closer, more tactile crop for the gallery (portrait 4:5 desktop, square mobile) while retaining the seller's selected slider/thumbnails behavior.
- Make the configured service menu the first catalog group and visually distinguish its cards with a restrained brand-colored edge.
- Any actual retail products remain visible after services as a secondary group.

### Hair salon — composition details
- Use an editorial split composition on desktop: business identity and description on one side, real portfolio image on the other; stack identity before imagery on mobile.
- Use a wider 4:3 portfolio frame and quiet, structured service rows; avoid beauty-style decorative cards.
- Place configured services before any product catalog, while retaining products as a separate group.

Both profiles must continue to respect the seller's palette, font, hero-gallery control and independent product/service layout settings. If there are no gallery assets, the layout must naturally collapse to the identity block without an empty media placeholder.


## Second implementation refinement — jewelry, treatment professional and gifts/cosmetics

These profiles now use distinct page-level hierarchy rather than only card styling:
- Jewelry: business identity and product catalog share the desktop opening; the optional real gallery follows the catalog. Mobile stacks identity, catalog, gallery and contact.
- Treatment professional: professional identity and configured service menu share the desktop opening; optional real gallery follows the service path. Mobile stacks identity, services, gallery and contact.
- Gifts/cosmetics: identity first, product discovery second, optional real gallery third, contact last.
- All placements reuse the same tenant records and existing action handlers. Missing gallery/catalog sections naturally disappear; no placeholder content is introduced. Seller palette, font, gallery mode and item layout preferences remain unchanged.


## Third implementation refinement — beauty institute and proposal planning

- Beauty institute: desktop identity and actual gallery sit side by side, followed by the full-width treatment/service menu; mobile stacks identity, gallery and services. Empty gallery states collapse without a reserved media column.
- Proposal planning: a spacious experience-led introduction is followed by a wide real-event gallery and a narrower configured package/service section. Inquiry and contact actions remain the existing tenant-configured actions.
- Both profiles reuse the live tenant content and preserve mixed products/services, seller branding, independent item layouts, gallery mode and existing booking/inquiry behavior.
---

# Evidence-led design phase — first four storefront foundations

Status: approved work order, 2026-11-16. These are design foundations to be researched and implemented iteratively; they are not a claim that the current preview already meets them.

The first release-design phase is intentionally limited to:
1. Default / general BTime — permanent fallback and regression baseline.
2. Nails studio.
3. Marriage proposals / proposal production.
4. Retail shops: jewelry, gifts and cosmetics.

Hair salon, beauty institute and treatment professional remain in the profile taxonomy but are deferred until these foundations pass visual and functional acceptance. Do not spend implementation effort on expanding those profiles during this phase unless required to fix a shared regression.

## Research references and extracted patterns

The following sources were reviewed on 2026-11-16. They are inspiration and evidence for patterns, not templates to copy. Where a source is a design agency/case study, its performance claims are not assumed to transfer to BTime.

### Nails studio
- [Gel Nails Calcot — PufaMix case study](https://www.pufamix.com/work/gel-nails-calcot/): portfolio, services/prices, booking, aftercare and location information work together; the portfolio is not a block of explanatory prose.
- [MMM Beauty — Doman Digital case study](https://www.domandigital.co.uk/work/mmm-beauty): booking-led structure and a clear mobile route to appointment booking.
- [Beauty Nails — Web Fabrika case study](https://web-fabrika.com/en/beauty-nails): real nail-design gallery, mobile image clarity and direct booking.
- [GlossGenius nail salon website examples (2026)](https://glossgenius.com/blog/nail-salon-websites): examples reinforce the combination of strong work imagery, scannable services and accessible booking.
- [LUXITA luxury nail salon portfolio](https://uiux.katherinedelorme.com/luxita): useful reference for balancing a distinct premium identity with easy booking and visible nail options.

**Design conclusion for BTime:** work imagery should be the primary visual proof, but it must not bury practical service information. Use a short section title such as "תיק עבודות" only; do not add generic introductory paragraphs. Gallery behavior must be reliable before any further decorative treatment. The services menu should be concise and scannable, showing configured price and duration where present. The primary appointment action must lead to the existing BTime booking flow.

**Palette direction:** Rose is the first suggested starting point for a soft feminine studio, Lavender for a cooler/creative nail-art identity, and Minimal for a monochrome studio. These are alternatives, not fixed classifications. Keep the chosen tenant palette.

### Marriage proposals and proposal production
- [Pearly Proposals](https://pearlyproposals.com/): immediate proposition, visible package/gallery paths, real setup imagery and a consultation action.
- [Proposal.Events packages](https://proposal.events/proposal-packages/): packages are differentiated by the level of production and actual inclusions; inquiry is a natural next step.
- [My Planner Friend](https://www.myplannerfriend.com/): clear explanation of what is handled for the customer and package tiers.
- [Wedding/event planner website examples — Velour](https://www.velourweb.com/blog/wedding-planner-website-examples): portfolio, named offers, repeated inquiry action and a clear first sentence are recurring structural patterns. Treat this as adjacent event-planning evidence, not a direct substitute for proposal-business research.

**Design conclusion for BTime:** sell the experience visually. Lead with a strong real event/setup image and a concise statement of what the business arranges. Follow with a real gallery, then only the packages/services actually configured. Keep one consistent inquiry action. Do not invent package tiers, pricing, testimonials, venues, event types or process claims. A proposal business without package data should still look complete with its real gallery and contact path.

**Palette direction:** Luxury is a possible starting point for formal/elegant setups; Natural or Rose may better fit outdoor, floral or intimate concepts. The real business photography and seller's saved palette determine the final result.

### Retail shops — jewelry, gifts and cosmetics
- [Aethel Fine Jewelry — 12TH STUDIO case study](https://12thstudio.com/work/project-02): editorial product discovery, high-resolution detail photography and product attributes that matter to shoppers.
- [Juri Jewelry — Stephen Muchara case study](https://www.stephenmuchara.com/work/juri/): restrained interface that lets product photography lead while preserving category/product discovery.
- [Stellar + Monique — Blinix case study](https://blinixsolutions.com/work/stellar-and-monique): photography-led editorial collections and a quiet interface.
- [Gregory Jewellers — Matt Barbelli case study](https://mattbarbelli.com.au/work/gregory-jewellers): real commerce screens show the need to support product variants, availability, prices and mobile browsing where those data exist.

**Design conclusion for BTime:** product photography, product names, prices and useful details take priority over generic business copy. The catalog should be discoverable immediately; do not put a large generic portfolio block before the products in a product-led shop. Jewelry can use a more editorial, restrained product composition. Gifts/cosmetics should favor approachable browsing and clear product scanning, not assume luxury. Show services separately when configured; never hide them because the profile is retail.

**Palette direction:** Luxury or Minimal are possible jewelry starting points; Rose, Lavender or Natural may suit gifts/cosmetics depending on the actual brand. Never impose a gold/cream luxury treatment on every shop.

## Shared token contract

For each of the three specialized foundations, write an explicit token sheet before implementation:
- Palette preset recommendation and semantic roles: primary, secondary, accent, background and text.
- Typography: supported font style, display/title/body hierarchy and Hebrew line-length behavior.
- Surfaces: background separation, border weight, radius and shadow rules.
- Media: gallery/product image ratios, object-fit/crop behavior, thumbnail behavior and missing-image handling.
- Actions: primary/secondary CTA appearance, placement and mobile reachability.
- Layout: content max-width, section spacing, grid/column behavior and mobile stacking.

Do not invent new hex values when an existing preset can express the concept. If a new palette is genuinely necessary, document why and request product approval before adding it.

## Acceptance gate — nails first

The nail studio profile is the first implementation target. It is not accepted until all of the following are verified on the real Noy Nails tenant content:
- Portfolio gallery renders the real gallery assets correctly on mobile and desktop; swipe/slider or thumbnails follow the seller's saved mode; no blank media region, broken crop, unexpected stretching or unusable navigation.
- The portfolio heading is only "תיק עבודות" (or the seller's own configured title if supported); no generic explanatory paragraph is added.
- Services are visually scannable and show only configured name, description, price and duration; optional fields do not create awkward blank space.
- The appointment CTA leads to the existing booking path and does not alter booking behavior.
- Any configured products remain visible and usable after the services.
- Existing seller palette, font, gallery mode and independent product/service layout settings remain respected.
- Test 320, 360, 375, 390 and 430 px, plus tablet and desktop; test no gallery, one image, multiple images, long service names and mixed product/service data.
- Compare actual screenshots with the research/design plan. A text-only or palette-only difference is a rejection.

Only after nails passes should proposal planning and retail receive the same research → tokens → architecture → implementation → screenshot acceptance sequence.

