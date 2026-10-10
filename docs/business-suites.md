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

Panel headings, fleet creation and the current booking's operation controls remain visible while scrolling. Bottom clearance follows the measured navigation height, including increased text size and the device safe area. Short landscape screens use ordinary scrolling for panel headers and action controls. Journey actions precede the map. These layout changes do not alter approval, assignment, payment or journey authorization.

## Records and authorization

`GET /operations/local-business/partner?role=…` selects the requested business profile. `GET /operations/worker/me` also returns `registered_roles` and business review summaries. Selecting an app is not an authorization grant: operational commands continue to require approved, unexpired memberships and the appropriate vehicle/booking assignment.

Existing `business_partners/{uid}` records retain their IDs and review history. Additional memberships use `{uid}:{role}` and store `user_id` as the verified identity. Admin reviews use the profile record's `id`; document ownership, vehicles, assignments, notifications and customer-facing operations use the original identity UID. No phone accounts or balances are duplicated.

A rental reserves its vehicle. Cab/shared bookings also reserve the actual assigned driver, or the owner when no driver is assigned. Owners can manage simultaneous bookings for separate cars and drivers. Owner-driver and assigned-driver reservations share an operator lock, including across owners. Driver changes cannot replace the assignment on a vehicle with outstanding bookings.

Vehicle rates remain owner-defined. Cab bookings retain the ₹500 minimum fare and ₹500 advance credited toward the final fare. Shared-ride fares remain owner-defined per seat. Fare collection, owner settlement reports and confirmed receipts remain distinct.

Account-scoped reads use warm snapshots and quiet background polling. Registration, uploads and operational commands happen only after a user action. Pending reviews, accepted bookings, quotes and receipts remain visible after submission.

## Shared-ride discovery and request alerts

Published departures enter pickup-area indexes in the same transaction as the departure. `GET /operations/local-business/transport/nearby` uses bounded future references and rechecks current vehicle/driver approval and remaining seats. It shows shared departures starting within 20 km; cab and rental catalogue coverage remains 8 km. Discovery responses contain public route pins and owner-set fares, without passenger records or private business documents. The actual joining search still requires forward travel and pickup/drop-off within 2 km of the verified road route.

The Cabs screen and Repaidians Feed/Work & market show the native transport rail. Home shows it after transport searches when the customer's existing optional personalisation is enabled. Only the transport category interest is retained; raw search text and precise location are not saved for suggestions. Turning personalisation off or resetting history clears the signal. Nearby reads share short memory caches and refresh quietly; a card's booking flow rechecks dates, availability and the full price before submission.

A join request atomically notifies both the owner and assigned driver. Their suites show a pending-request cue across panels, with a deliberate **Enable request bell** control in Account settings because browsers require a user gesture for audio. Silencing the bell retains the request; new requests can ring again. The driver can open the exact shared ride and review passengers; the owner retains acceptance and pricing authority. Requests and decisions reach open suites through quiet polling, normally within five seconds, while backgrounded/offline pages refresh when visible again.

Google road geometry is required for publication. The Cloud Run release binds `GOOGLE_ROUTES_API_KEY` to the existing `google-routes-api-key` secret, and checks routing readiness before promoting the candidate. Provider failures retain the form and do not create fake straight-line routes or departures.

## Validation

Run the backend suite from `backend` with `.venv/bin/python -m pytest -q`; the membership and fleet regressions are in `test_business_profiles.py`. Run frontend unit tests and the production build with `npm --prefix web test` and `npm --prefix web run build`.

With Vite on port 5187 and Playwright available, run `web/tests/business-suites.browser.mjs`. It starts a disposable SQLite API and exercises multi-role registration, independent approval, restricted driver panels, uploads, weighing and payment confirmation, quiet polling, and light/dark layouts at 320, 465 and 1440 pixels with 100%/200% text scaling. Cab checks cover the pinned navigation, grouped booking destinations, real worker portal, focus and breadcrumbs, multi-record selection, active/history changes, direct schedule entry and landscape text zoom. Accessibility scans include enhanced AAA text contrast. `web/tests/journeys.browser.mjs` also verifies shared departure publication, passenger joining and boarding, live location, guest tracking and link expiry. The fixtures never write to production.

`test_transport_discovery.py` checks the 20 km boundary, approval/capacity filtering, date-line/polar cells, notification replay protection, route geometry and personalisation consent/reset. `web/tests/transport-discovery.browser.mjs` verifies native customer/Repaidians discovery, fare consent, driver audio and pending-request controls, enhanced contrast and idle polling without submissions.

Shared-ride management uses a single ride card: a stacked origin/destination, departure/fare/seats facts, compact read-only progress, and unboxed passenger rows. Passenger controls stay beside their passenger; journey controls follow the list. Pickup/payment explanations and journey terms/activity start collapsed, with owner cancellation inside journey details. On phones the shared-ride header scrolls normally so it does not cover controls. Start requires a recorded boarding; Finish requires all boarded passengers to have a recorded drop-off. These reflect existing server rules; live position and geofence checks still run on the server.


## Departure reminders and time changes

The cab owner and driver suites omit the redundant breadcrumb. Their shared-ride cards use the brand shadow, strong status contrast, and compact passenger rows with boarding beside the passenger. Notification setup lives in Account; pending requests remain visible across panels. Customer sound and push settings are also available in the notification drawer. Sound is enabled by a gesture for the current browser session, with account changes clearing it. Quiet reads prime existing notifications without ringing them again. Browser push uses the existing account-bound registration and opens the exact ride.

Published rides receive a bounded reminder index in the same transaction. The existing authenticated work-dispatch scheduler processes due rides and sends a single reminder per recipient and scheduled departure, beginning 15 minutes before departure. It also backfills older published rides in small checkpointed pages. Open pages receive the same operational notes through quiet polling. The durable push relay rechecks the current schedule, recipient and arrival state before sending, so a stale reminder is skipped after rescheduling.

Accepted passengers can explicitly enable precise arrival checks while their ride page is open during the hour before departure. Only their own status and the cab's fresh position are returned. The server confirms arrival within 300 m only when both readings are at most 75 seconds old and their combined accuracy uncertainty fits inside the boundary. Missing, stale or boundary-uncertain readings produce an unconfirmed arrival reminder; they never claim the passenger is outside or show stale cab directions. Arrival checks stop at departure. Boarding, drop-off, cancellation and departure expiry clear the passenger's arrival point.

Owners and accepted, assigned drivers can publish departures on their approved available vehicles. Either operator can reschedule during the 15 minutes before or after departure if seats remain and nobody has boarded. The new time must be later, the entire interval must be available, and a reason is required. Seats and fares remain unchanged. Journey participants receive the previous time, exact new time and reason in their ride panel and notification bell. Public discovery shows the updated schedule without the private reason; no customer approval or acknowledgement is requested. Reminder keys are reset for the new schedule.

Push alerts respect device notification permission, volume, channel preferences and Do Not Disturb. Android source handles shared-ride titles, the existing arrival sound channel and exact-ride notification links. Updated native tap routing and foreground labels require customer and agent APKs built and signed with their existing release keys; a web deployment does not rebuild those packages.

`test_shared_departure_alerts.py` verifies fresh/stale GPS, boundary accuracy, deduplication, reschedule permissions and reservation conflicts, durable push delivery, bounded backfill and assigned-driver publication. `web/tests/shared-ride-mobile.browser.mjs` exercises real rescheduling, passenger directions and arrival checks alongside boarding, drop-off and fare receipts on phone layouts with enhanced AAA contrast.
