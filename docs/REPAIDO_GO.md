# Repaido Go

Customer travel now has its own destination at `/go?ride=bike` or
`/go?ride=cab`. Home has one Go entry, and the second mobile navigation item
opens Go. Home services remain available from the home service grid and its
catalogue actions, plus All Services in desktop navigation.

Existing Market links with `marketSub=mobility` or `sub=mobility` open Go. The
Market Rides shortcut also opens Go. Shared rides, self-drive, cab rental and
shared bikes remain available under More, rather than competing with the main
Bike and Cab choices.

## Booking and location

Go composes the existing BikeRides, TransportRail and RideWizard components.
Readiness, authentication, quotes, consent, acceptance, pickup OTP, geofences,
completion review and cash confirmation retain their native APIs and rules.
CustomerLiveRide continues hosting active rides across customer sections.

The visited Go screen and bike route draft stay mounted across section and mode
changes. Hidden discovery pauses its reads; switching accounts resets the
participant scope. Go cab browsing uses the existing restricted Google Maps
configuration. Before acceptance, cab pins represent public approximate areas;
they never expose a driver's private journey coordinates or invent supply.

## Motion

Go uses solid violet, lime, coral and teal surfaces. Colour distinguishes
navigation, primary actions, fares and rider readiness, alongside explicit text
and icons. Driver duty, incoming offers, vehicle assignments and actual finance
records use the same system. Other business roles retain their own styling.

The supplied references contribute different interaction patterns:

| Reference pattern | Repaido Go behaviour |
| --- | --- |
| Map-led Jugnoo / Ola discovery | Bike and Cab choices above Google Maps, with pickup and route controls in a rounded sheet |
| Ola searching waves | Three moving rings and the appropriate bike/car icon while the server is searching; cancellation stays available |
| Rapido duty and earnings | Compact duty control, prominent map, real company-cash/salary details, and green incoming offers |
| GoCab trip cards | A shared full-screen ride, rider details, route, fare and completion actions |
| Supplied motion video | Finger-following ride sheets, slide-to-search, and animated transitions between booking steps |

These are adapted interaction patterns, not pixel-identical copies. Repaido
retains its own identity and actual service capabilities: scheduled cab slots,
office-cash salary records and server-reported availability. It does not display
sample balances, invented arrival times or pretend to provide turn-by-turn
navigation.

MotionPage animates Go modes, booking steps and driver sections for 520 ms,
without remounting maps or animating periodic reads. Other destinations use
260 ms. Go dialogs and sheets enter in roughly 600 ms; ordinary control feedback
uses 140–240 ms. No transition delays a command or gates network work.

The ride-sheet handle follows vertical pointer movement before release, snaps
after a deliberate drag, and supports click and arrow keys. Small or cancelled
drags reset without changing the sheet state. Search and final request controls
require a completed horizontal swipe, or native Enter/Space activation. A tap,
partial swipe or cancelled touch never submits. Native form validation, consent
and busy/idempotency protections remain in force.

Vehicle markers interpolate only between confirmed readings over 450 ms. A new
reading interrupts from the displayed point; stale or removed GPS clears the
marker immediately. This visual interpolation never enters location commands or
completion eligibility. Map instances survive position refreshes.

System reduced motion and the existing app setting suppress these transitions;
changing the system setting also cancels a running page transition.

## Local verification

Start Vite on `127.0.0.1:5187`, then run from `web`:

```bash
node tests/repaido-go.browser.mjs
node tests/map-motion.browser.mjs
node tests/ride-workspace.browser.mjs
node tests/modal-interactions.browser.mjs
node tests/customer-shell.browser.mjs
node tests/worker-compact-layout.browser.mjs
node tests/go-driver-design.browser.mjs
npm test
npm run build
```

Set `PLAYWRIGHT_MODULE` to the installed Playwright package when required. Go's
browser test uses a disposable SQLite API, native bike and cab booking commands,
and an explicit Google Maps SDK double. It covers home separation, confirmed
stops, mode drafts, requests and cancellation, history, Back/reload/deep links,
responsive layout and WCAG A/AA checks. This does not constitute a production
GPS or payment test. Releasing these changes requires a requested website
release under AGENTS.md; no backend deployment is needed for this batch.

Go also exercises real browser touch cancellation and completed swipes, keyboard
form validation and single-request submission. Ride-workspace checks measure
sheet movement before pointer release, map-instance preservation, and actual
search-ring animations with reduced motion enabled and disabled. Driver checks
cover idle and incoming-offer states at 320/466 px, 100/200% text, light and dark
themes. Set `REPAIDO_QA_VIDEO=1` on the Go test to record a local browser preview
(requires Playwright's ffmpeg executable).
