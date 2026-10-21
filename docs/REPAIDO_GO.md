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

MotionPage animates customer and business destination changes for 260 ms without
remounting their contents. The random logo overlays have been removed. Shared
dialogs enter in 280 ms, sheets settle in 360 ms, and ordinary state changes use
140 ms. No transition delays a command, steals focus or gates network work.

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
