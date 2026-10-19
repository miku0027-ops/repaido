# Bike development verification — 19 October 2026

This records local verification of the bike pilot and compact Market highlights.
It is not a production activation record. Tests use isolated databases, demo
identities and provider doubles unless specifically stated otherwise.

The later growth/independent-earnings batch is recorded in
[BIKE_RESILIENCE.md](BIKE_RESILIENCE.md), including the latest regression counts,
native funding tests, browser evidence and bounded local load results. The
table below retains the earlier pilot verification record.

| Check | Result |
| --- | --- |
| Full backend regression: `backend/.venv/bin/python -m pytest -q --tb=short backend` | 1,668 passed, 25 skipped. Skips include optional emulator/provider configurations. |
| Native Firestore: `FIRESTORE_EMULATOR_HOST=127.0.0.1:8793 backend/.venv/bin/python -m pytest -q --tb=short backend/test_bike_firestore.py` | Five passed against the real loopback Firestore emulator, each in a fresh demo project with anonymous credentials. |
| Final assignment guards: `backend/test_bike_assignment_guards.py` | Eleven passed, including reassignment of a free fleet vehicle while its outgoing operator is working on another bike. |
| Frontend unit suite: `npm --prefix web test` | 364 passed. |
| Actual website target: `npm --prefix web run build:cpanel` | Passed after the final customer source change. TypeScript and Vite completed. |
| Native customer journey: `web/tests/bike-fullstack.browser.mjs` | Real main API and SQLite: approved roster/funding/policy, another passenger, ordered reservation, free trip, GPS/code start, completion, paid quote and exact cash confirmation. |
| Verified mobile: `web/tests/bike-phone.browser.mjs` | Five flow checks; eight new light/dark, 320/465 px, 100/200% text variants with no detected WCAG A/AA violations. Verification keeps the account, refreshes the token and requires a new reviewed request. |
| Notifications: `web/tests/bike-notifications.browser.mjs` | Eleven routing, commit-order, duplicate-click and account-change checks. Bike IDs take priority over generic shared-ride IDs. |
| Customer history: `web/tests/bike-history.browser.mjs` | Older cursor pages, exact older notification selection and authorized-account isolation. |
| Customer presentation: `web/tests/bike-rides.browser.mjs` | Search/review/live states, responsive themes, 200% text, stale GPS, map failure and reduced motion. |
| Rider: `web/tests/bike-rider.browser.mjs`, `bike-rider-lifecycle.browser.mjs` | Current/next trip, retries, reconnect, GPS expiry, code handling, pause, opt-in one-shot sounds, salary acknowledgement and company cash reporting. |
| Company: `web/tests/bike-admin.browser.mjs` | Twelve groups including schema-validated submitted payloads, optimistic versions, dispute evidence, cash/salary separation, older-history retry and responsive accessible tables. |
| Fleet: `web/tests/vehicle-services.browser.mjs` | Bike tariff fields hidden, one seat and supported modes, preserved metadata; car rental fields and exact saved rates retained. |
| Market: `web/tests/market-highlights.browser.mjs` | Eighty slide/layout combinations; all actions retained in the compact Benefits sheet. Panel reduced from 342 px to 196 px at a 487 px viewport. |

The backend suite covers genuine transaction contention, duplicate dispatch,
one future rider slot, verified-mobile quota sharing between accounts, weekly
boundaries, cooldown, cancellations, fixed accepted quotes, expiry fairness,
private GPS/code projection, physical conflict guards, salary obligations and
company remittance credits. Pub/Sub adapter tests check actual SDK call contracts,
ordering configuration, readiness and acknowledge-after-commit behavior using
test doubles; they do not establish a live broker connection.

The Firestore suite and final free-fleet reassignment case were added and run
separately after the full backend regression. Native Firestore checks cover the
complete free journey, HMAC quota replay, concurrent same-account holds, competing
customers in committed order, next-slot promotion, preservation of a different
vehicle's slot and exact company remittance without settling the rider's salary.

The production build reports large existing application chunks and mixed
static/dynamic import warnings. The build succeeds; this work does not claim a
complete application bundle optimization or a measured production performance SLA.

Not exercised locally: live Pub/Sub resources/ADC recovery, real Google Routes
charges/coverage, Firebase SMS delivery and real-device background GPS. Complete
the [activation checks](BIKE_RIDES.md#production-activation) before enabling the
pilot. Accessibility checks cover the tested states and do not certify the
entire application.
