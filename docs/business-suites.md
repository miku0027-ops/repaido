# Business suites

From `/worker`, choose **Business apps** to enter a dedicated workspace. Direct entries are `/worker?mode=cab_owner`, `/worker?mode=driver`, and `/worker?mode=scrap_owner`. The existing agent and contractor entries remain available.

One Firebase phone identity can hold a service-work profile and independently reviewed cab-owner, driver and scrap-collector profiles. Creating another business does not replace the existing worker or business profile. A new business remains pending until its own documents are approved; expiry or rejection of one profile does not revoke the others.

- Cab owners manage shared departures, cab bookings, self-drive rentals, fleet rates, scheduling and owner transfers.
- Drivers see their accepted vehicle assignments and assigned cab/shared journeys. Fleet pricing, owner settlements and rental management stay in the owner workspace.
- Scrap collectors manage requests, inspection and itemized net-weight quotes, customer approval, actual payment references and customer-confirmed receipts.
- Customers choose a shared ride, a cab with a driver or a self-drive rental. Collection and ride cards show progress through their respective lifecycles.

## Cab navigation and working layout

Cab owners have five persistent bottom destinations: **Home**, **Bookings**, **Fleet**, **Schedule** and **More**. Bookings contains Shared rides, Cab bookings and Self-drive; More contains Payments and Account. Drivers have **Today**, **Cab rides**, **Shared rides**, **Vehicles** and **Account**. The same navigation works at mobile and desktop widths. Breadcrumbs show the current panel and provide a return to its parent.

Scrap collectors have five persistent destinations: **Home**, **Collect**, **Inspect**, **Payments** and **More**. More contains Schedule and Account. Each suite keeps its own work, actions and permissions.

The compact home screen shows counts, the next scheduled booking and service shortcuts. Selecting the scheduled booking opens that record directly. Cab, shared-ride and scrap queues display one selected record with a native picker and previous/next controls, instead of stacking every full booking. Quiet polling retains the selected record when new requests arrive; a record that leaves the current filter falls back to an available record. Customer record lists retain their existing layout.

Panel breadcrumbs, fleet creation and the current booking's operation controls remain visible while scrolling. Bottom clearance follows the measured navigation height, including increased text size and the device safe area. Short landscape screens use ordinary scrolling for panel headers and action controls. Journey actions precede the map. These layout changes do not alter approval, assignment, payment or journey authorization.

## Records and authorization

`GET /operations/local-business/partner?role=…` selects the requested business profile. `GET /operations/worker/me` also returns `registered_roles` and business review summaries. Selecting an app is not an authorization grant: operational commands continue to require approved, unexpired memberships and the appropriate vehicle/booking assignment.

Existing `business_partners/{uid}` records retain their IDs and review history. Additional memberships use `{uid}:{role}` and store `user_id` as the verified identity. Admin reviews use the profile record's `id`; document ownership, vehicles, assignments, notifications and customer-facing operations use the original identity UID. No phone accounts or balances are duplicated.

A rental reserves its vehicle. Cab/shared bookings also reserve the actual assigned driver, or the owner when no driver is assigned. Owners can manage simultaneous bookings for separate cars and drivers. Owner-driver and assigned-driver reservations share an operator lock, including across owners. Driver changes cannot replace the assignment on a vehicle with outstanding bookings.

Vehicle rates remain owner-defined. Cab bookings retain the ₹500 minimum fare and ₹500 advance credited toward the final fare. Shared-ride fares remain owner-defined per seat. Fare collection, owner settlement reports and confirmed receipts remain distinct.

Account-scoped reads use warm snapshots and quiet background polling. Registration, uploads and operational commands happen only after a user action. Pending reviews, accepted bookings, quotes and receipts remain visible after submission.

## Shared-ride discovery and request alerts

Published departures enter pickup-area indexes in the same transaction as the departure. `GET /operations/local-business/transport/nearby` uses bounded future references and rechecks current vehicle/driver approval and remaining seats. It shows shared departures starting within 20 km; cab and rental catalogue coverage remains 8 km. Discovery responses contain public route pins and owner-set fares, without passenger records or private business documents. The actual joining search still requires forward travel and pickup/drop-off within 2 km of the verified road route.

The Cabs screen and Repaidians Feed/Work & market show the native transport rail. Home shows it after transport searches when the customer's existing optional personalisation is enabled. Only the transport category interest is retained; raw search text and precise location are not saved for suggestions. Turning personalisation off or resetting history clears the signal. Nearby reads share short memory caches and refresh quietly; a card's booking flow rechecks dates, availability and the full price before submission.

A join request atomically notifies both the owner and assigned driver. Their suites show a pending-request cue across panels, with a deliberate **Enable request bell** control because browsers require a user gesture for audio. Silencing the bell retains the request; new requests can ring again. The driver can open the exact shared ride and review passengers; the owner retains acceptance and pricing authority. Requests and decisions reach open suites through quiet polling, normally within five seconds, while backgrounded/offline pages refresh when visible again.

Google road geometry is required for publication. The Cloud Run release binds `GOOGLE_ROUTES_API_KEY` to the existing `google-routes-api-key` secret, and checks routing readiness before promoting the candidate. Provider failures retain the form and do not create fake straight-line routes or departures.

## Validation

Run the backend suite from `backend` with `.venv/bin/python -m pytest -q`; the membership and fleet regressions are in `test_business_profiles.py`. Run frontend unit tests and the production build with `npm --prefix web test` and `npm --prefix web run build`.

With Vite on port 5187 and Playwright available, run `web/tests/business-suites.browser.mjs`. It starts a disposable SQLite API and exercises multi-role registration, independent approval, restricted driver panels, uploads, weighing and payment confirmation, quiet polling, and light/dark layouts at 320, 465 and 1440 pixels with 100%/200% text scaling. Cab checks cover the pinned navigation, grouped booking destinations, real worker portal, focus and breadcrumbs, multi-record selection, active/history changes, direct schedule entry and landscape text zoom. Accessibility scans include enhanced AAA text contrast. `web/tests/journeys.browser.mjs` also verifies shared departure publication, passenger joining and boarding, live location, guest tracking and link expiry. The fixtures never write to production.

`test_transport_discovery.py` checks the 20 km boundary, approval/capacity filtering, date-line/polar cells, notification replay protection, route geometry and personalisation consent/reset. `web/tests/transport-discovery.browser.mjs` verifies native customer/Repaidians discovery, fare consent, driver audio and pending-request controls, enhanced contrast and idle polling without submissions.

Shared-ride management uses a single ride card: a stacked origin/destination, departure/fare/seats facts, compact read-only progress, and unboxed passenger rows. Passenger controls stay beside their passenger; journey controls follow the list. Pickup/payment explanations and journey terms/activity start collapsed, with owner cancellation inside journey details. On phones the shared-ride header scrolls normally so it does not cover controls. Start requires a recorded boarding; Finish requires all boarded passengers to have a recorded drop-off. These reflect existing server rules; live position and geofence checks still run on the server.
