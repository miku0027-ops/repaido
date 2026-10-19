# Rides experience review

The Market destination is **Rides**. A new visit opens Bike; explicit trip links
and existing transport preferences still select the intended service. Bike, Cab,
Shared ride, Self-drive and Cab rental remain separate booking products.

## What changed

- A shared navy, slate and white theme, Material icons and restrained depth.
- Service selection above the trip workspace, with a compact alternative rail.
- One My rides dialog for existing bike, cab, rental and shared records. Records
  load when opened rather than expanding the discovery page.
- Customer bike route controls, rider choices, fare review, trip progress and
  arrival/payment actions with details disclosed when needed.
- Rider current-stop controls, request expiry, fresh arrival cues, next-trip
  reservations, earlier history and separate money records.
- Responsive reflow, minimum touch targets, visible focus, dark mode and reduced
  motion. Tile failures retain actual pins and an explicit retry state.
- Fullscreen maps use a native dialog above the workspace or existing booking
  dialog. Escape returns focus to the map control and preserves the booking.

## Behavior retained and checked

| Area | Existing business behavior |
| --- | --- |
| Bike launch | Configured route limits, weekly allowance, eligibility and funding checks; no guaranteed free match |
| Fare | Agreed total and demand adjustment; internal per-km pricing stays private |
| Passenger | Self or another passenger, with consent before sharing their details |
| Matching | Real server matches and next-slot requests; no fabricated vehicles, ratings or arrival times |
| Pickup | Rider acceptance, pickup code, fresh GPS and server distance checks |
| Completion | Arrival confirmation, paid receipt or free completion, disputes and cancellation |
| Rider money | Salaried roster, independent earning approval, company cash and transfers stay separate |
| Other services | Shared search/join, dated cab requests, self-drive quotes/licence upload and cab rental remain native flows |

## Functional corrections

Verified rider contact is captured privately on acceptance. It is exposed only to
the booking customer while an accepted trip is active, not in public discovery,
queued offers, broker events or closed history. Older trips without a verified
acceptance contact are not given an invented phone number. This uses ordinary
telephone links, not masked calling.

Rider history can load earlier pages. An expired online session can be ended,
expired offers cannot be accepted, stale/completed trips do not retain a live
arrival cue, and dispute input matches server validation. Newer trip versions
survive racing reads. A reload resumes foreground GPS only with existing browser
permission; it does not request permission automatically.

Customer reloads resume the current physical journey before outstanding offers
or receipts. This happens once per account; explicit trip links take precedence,
and returning to the ride list does not cause background refreshes to reopen it.
The rider workspace puts the main stop action before the map and enters that
workspace once after its initial data loads, without repeatedly moving the page.

## Customer tracking and Home activity

Customer shared trips use a status-first card with a published-route graphic,
the passenger's own seat/fare and the agreed pickup pins. Journey terms, payment
records and arrival-location checks remain available through disclosures. Owner
and driver controls keep their separate workflow. A fresh server stop check is
required for the live green arrival cue; a stale reading does not imply arrival.

Bookings uses one Active/History control across bike, cab and shared records.
Empty product sections stay quiet; one compact empty state appears after all
three reads finish successfully. Errors keep their own retry controls, and
existing records remain available when another service cannot load.

Home shows customer-owned connected rides and service work in a compact rail.
Scheduled pickup waiting appears within the existing one-hour arrival window;
physical journeys remain visible while active. Completed trips and financial-only
follow-up leave Home on the next authoritative read and remain in Bookings.
The Home reader uses existing account-scoped caches, pauses when hidden/offline,
and labels retained data when an update is delayed. It does not request GPS or
change a trip. Selecting a card opens that exact booking and service context.

Activity and Business accounts share an aligned action row. Header cart, bell
and profile icons use official filled Material glyphs. The mint Help badge keeps
its original logo and overlaps the dock edge without covering navigation targets.
The booking service picker keeps whole labels in a compact horizontal rail and
reveals the selected or keyboard-focused destination at enlarged text sizes.

## Verification and limits

Relevant automated checks are in `web/tests/rides-market.browser.mjs`,
`bike-rides.browser.mjs`, `bike-rider.browser.mjs`,
`bike-rider-lifecycle.browser.mjs`, `bike-rider-shell.browser.mjs`,
`bike-resume.browser.mjs`, `journey-fullscreen.browser.mjs`,
`mobility-forms.browser.mjs`, `customer-live-app.browser.mjs`,
`customer-live-activity.browser.mjs`, `customer-shell.browser.mjs`,
`shared-customer.browser.mjs` and the backend bike lifecycle suites. Browser
fixtures use isolated or controlled data rather than production customer trips.

These are Repaido flows, not a claim of feature parity with current Ola, Rapido or
Jugnu apps. Native background tracking, masked calling and a guarantee of traffic
prediction or continuous connectivity are not supplied by this UI work. Live web
updates require connectivity and the rider workspace to remain open. Admin
approval, fare, funding and cloud activation gates continue to apply. This work
does not itself deploy or activate those services.
