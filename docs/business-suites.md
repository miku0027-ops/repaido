# Business suites

From `/worker`, choose **Business apps** to enter a dedicated workspace. Direct entries are `/worker?mode=cab_owner`, `/worker?mode=driver`, and `/worker?mode=scrap_owner`. The existing agent and contractor entries remain available.

One Firebase phone identity can hold a service-work profile and independently reviewed cab-owner, driver and scrap-collector profiles. Creating another business does not replace the existing worker or business profile. A new business remains pending until its own documents are approved; expiry or rejection of one profile does not revoke the others.

- Cab owners manage shared departures, cab bookings, self-drive rentals, fleet rates, scheduling and owner transfers.
- Drivers see their accepted vehicle assignments and assigned cab/shared journeys. Fleet pricing, owner settlements and rental management stay in the owner workspace.
- Scrap collectors manage requests, inspection and itemized net-weight quotes, customer approval, actual payment references and customer-confirmed receipts.
- Customers choose a shared ride, a cab with a driver or a self-drive rental. Collection and ride cards show progress through their respective lifecycles.

## Records and authorization

`GET /operations/local-business/partner?role=…` selects the requested business profile. `GET /operations/worker/me` also returns `registered_roles` and business review summaries. Selecting an app is not an authorization grant: operational commands continue to require approved, unexpired memberships and the appropriate vehicle/booking assignment.

Existing `business_partners/{uid}` records retain their IDs and review history. Additional memberships use `{uid}:{role}` and store `user_id` as the verified identity. Admin reviews use the profile record's `id`; document ownership, vehicles, assignments, notifications and customer-facing operations use the original identity UID. No phone accounts or balances are duplicated.

A rental reserves its vehicle. Cab/shared bookings also reserve the actual assigned driver, or the owner when no driver is assigned. Owners can manage simultaneous bookings for separate cars and drivers. Owner-driver and assigned-driver reservations share an operator lock, including across owners. Driver changes cannot replace the assignment on a vehicle with outstanding bookings.

Vehicle rates remain owner-defined. Cab bookings retain the ₹500 minimum fare and ₹500 advance credited toward the final fare. Shared-ride fares remain owner-defined per seat. Fare collection, owner settlement reports and confirmed receipts remain distinct.

Account-scoped reads use warm snapshots and quiet background polling. Registration, uploads and operational commands happen only after a user action. Pending reviews, accepted bookings, quotes and receipts remain visible after submission.

## Validation

Run the backend suite from `backend` with `.venv/bin/python -m pytest -q`; the membership and fleet regressions are in `test_business_profiles.py`. Run frontend unit tests and the production build with `npm --prefix web test` and `npm --prefix web run build`.

With Vite on port 5187 and Playwright available, run `web/tests/business-suites.browser.mjs`. It starts a disposable SQLite API and exercises multi-role registration, independent approval, restricted driver panels, uploads, weighing and payment confirmation, quiet polling, and light/dark layouts at 320, 465 and 1440 pixels with 100%/200% text scaling. Accessibility scans include enhanced AAA text contrast. The fixture never writes to production.
