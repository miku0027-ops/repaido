# Business suites

From `/worker`, choose **Business apps** to enter a dedicated workspace. Direct entries are `/worker?mode=cab_owner`, `/worker?mode=driver`, and `/worker?mode=scrap_owner`. The existing agent and contractor entries remain available.

One Firebase phone identity can hold a service-work profile and independently reviewed cab-owner, driver and scrap-collector profiles. Creating another business does not replace the existing worker or business profile. A new business remains pending until its own documents are approved; expiry or rejection of one profile does not revoke the others.

- Cab owners manage shared departures, cab bookings, self-drive rentals, fleet rates, scheduling and owner transfers.
- Drivers see their accepted vehicle assignments and assigned cab/shared journeys. Fleet pricing, owner settlements and rental management stay in the owner workspace.
- Scrap collectors manage requests, inspection and itemized net-weight quotes, customer approval, actual payment references and customer-confirmed receipts.
- Customers choose a shared ride, a cab with a driver or a self-drive rental. Collection and ride cards show progress through their respective lifecycles.

## Cab navigation and working layout

Cab owners have five persistent bottom destinations: **Home**, **Bookings**, **Fleet**, **Schedule** and **More**. Bookings contains Shared rides, Cab bookings and Self-drive; More contains Payments and Account. Drivers have **Today**, **Cab rides**, **Shared rides**, **Vehicles** and **Account**. The same navigation works at mobile and desktop widths. Breadcrumbs show the current panel and provide a return to its parent.

The compact home screen shows counts, the next scheduled booking and service shortcuts. Selecting the scheduled booking opens that record directly. Cab and shared-ride queues display one selected record with a native picker and previous/next controls, instead of stacking every full booking. Quiet polling retains the selected record when new requests arrive; a record that leaves the current filter falls back to an available record. Customer and scrap record lists retain their existing layout.

Panel breadcrumbs, fleet creation and the current booking's operation controls remain visible while scrolling. Bottom clearance follows the measured navigation height, including increased text size and the device safe area. Short landscape screens use ordinary scrolling for panel headers and action controls. Journey actions precede the map. These layout changes do not alter approval, assignment, payment or journey authorization.

## Records and authorization

`GET /operations/local-business/partner?role=…` selects the requested business profile. `GET /operations/worker/me` also returns `registered_roles` and business review summaries. Selecting an app is not an authorization grant: operational commands continue to require approved, unexpired memberships and the appropriate vehicle/booking assignment.

Existing `business_partners/{uid}` records retain their IDs and review history. Additional memberships use `{uid}:{role}` and store `user_id` as the verified identity. Admin reviews use the profile record's `id`; document ownership, vehicles, assignments, notifications and customer-facing operations use the original identity UID. No phone accounts or balances are duplicated.

A rental reserves its vehicle. Cab/shared bookings also reserve the actual assigned driver, or the owner when no driver is assigned. Owners can manage simultaneous bookings for separate cars and drivers. Owner-driver and assigned-driver reservations share an operator lock, including across owners. Driver changes cannot replace the assignment on a vehicle with outstanding bookings.

Vehicle rates remain owner-defined. Cab bookings retain the ₹500 minimum fare and ₹500 advance credited toward the final fare. Shared-ride fares remain owner-defined per seat. Fare collection, owner settlement reports and confirmed receipts remain distinct.

Account-scoped reads use warm snapshots and quiet background polling. Registration, uploads and operational commands happen only after a user action. Pending reviews, accepted bookings, quotes and receipts remain visible after submission.

## Validation

Run the backend suite from `backend` with `.venv/bin/python -m pytest -q`; the membership and fleet regressions are in `test_business_profiles.py`. Run frontend unit tests and the production build with `npm --prefix web test` and `npm --prefix web run build`.

With Vite on port 5187 and Playwright available, run `web/tests/business-suites.browser.mjs`. It starts a disposable SQLite API and exercises multi-role registration, independent approval, restricted driver panels, uploads, weighing and payment confirmation, quiet polling, and light/dark layouts at 320, 465 and 1440 pixels with 100%/200% text scaling. Cab checks cover the pinned navigation, grouped booking destinations, real worker portal, focus and breadcrumbs, multi-record selection, active/history changes, direct schedule entry and landscape text zoom. Accessibility scans include enhanced AAA text contrast. `web/tests/journeys.browser.mjs` also verifies shared departure publication, passenger joining and boarding, live location, guest tracking and link expiry. The fixtures never write to production.
