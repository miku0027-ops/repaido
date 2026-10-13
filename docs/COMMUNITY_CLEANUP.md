# Scrap and community cleanup

The customer Sell scrap destination now has Sell my scrap, Report litter and My impact. Sales retain the existing inspection, net weighing, customer-approved quote and receipt flow. Public reports are a separate lifecycle: a report does not establish ownership or authorise removal of public property.

## Roles and workflow

1. A signed-in customer submits 1–3 private JPEG/PNG photographs, a confirmed map pin, landmark/city, material category and description. Photos use the existing private document service and its image validation/size limits.
2. An administrator opens **Transport & scrap reviews → Community cleanup reports & cash rewards**. Approval requires a collection-permission reference. Hazardous reports cannot be approved for ordinary collectors; an actual specialist-authority referral reference can be recorded instead. This does not contact a municipality automatically.
3. An optional cash reward is approved from **Repaido funds**. The admin records the funding approval reference. No reward is inferred from weight, scrap resale value or a market rate. The initial per-report approval cap is ₹1,000; zero is valid. This is a manual budget approval record, not a bank-balance check or transfer.
4. A current, approved scrap collector within 8 km can accept the report through **Community cleanup** in the collector suite. Assignment is exclusive. A collector can release an unsubmitted task with a reason; an admin can reopen an assigned or submitted task for reassignment. Existing reward approval stays unchanged, and the new collector must submit fresh completion evidence. Reporters cannot collect their own reports. An admin cannot approve or verify a report they submitted or collected.
5. The collector submits new after photographs and the recycling/disposal destination, from a recent device position within 300 metres of the site. Device location is a proximity check, not proof against GPS spoofing. Administrators must inspect the evidence and permission.
6. Admin verification completes the cleanup and awards 10 non-cash points exactly once. Rework returns the report to the collector and requires fresh evidence. Rejection/referral/cancellation earns no points. Captain status starts at 100 points; these are initial product rules, not market or government standards.
7. After actual cash handover, an admin records the cash receipt reference. Only the reporter confirms receipt. A payment concern blocks receipt completion until an administrator records their investigation; the reporter still confirms receipt themselves. No payment gateway or automatic disbursement is used.

“Swachh Bharat Captain” is explicitly a Repaido community badge, not government certification. Cash is not described as tax-exempt. Applicable accounting and tax treatment remains an operational responsibility.

## Privacy, integrity and operational limits

- Evidence is private to the reporter, assigned collector, approved nearby candidates at the approved stage, and authorised administrators. There is no public photo feed, reporter contact directory or public location leaderboard.
- Customers are asked not to photograph faces/number plates or touch hazardous material. Hazardous material follows the referral path.
- A 30-metre same-city open-report check and transaction guards prevent ordinary duplicates, including racing submissions. This is not image-content duplicate detection; moderators still check repeat/reused scenes and incorrect cities.
- Uploaded evidence IDs cannot be reused across reports or as new completion evidence. Each authenticated user can submit at most five reports per day. The underlying private-upload throttle remains in effect.
- Commands use expected versions and idempotency keys; completion and points writes occur in the same transaction. Reward status and points are independent, so an unpaid cash reward cannot look like a confirmed receipt.
- SQLite adds lookup indexes; Firestore uses the existing server-only `ops_*` store with single-field lookups. The admin queue fetches at most 51 records per page and separates active/history. Closed admin panels do not poll. Mounted views refresh quietly every 30 seconds and pause scheduled refreshes in background tabs.
- Customer and collector lists currently display their latest 100 records. Points totals include the complete earned ledger. Large-scale regional dispatch, public content sharing, automatic authority integrations, accounting exports and configurable campaign policies are not part of this version.

## Validation and release

`backend/.venv/bin/python -m pytest backend/test_cleanup.py backend/test_local_business.py -q` checks lifecycle, privacy, competing assignments, racing duplicates, replay/version handling, fresh geofence/evidence, referral, payment disputes, badge thresholds, throttling and admin pagination.

With local Vite on port 5187, `web/tests/cleanup.browser.mjs` uses a disposable SQLite API and private in-memory image storage to exercise the real customer/admin/collector UI. It checks actual image upload, map confirmation, approval, GPS completion, verification, cash receipt, and mobile/desktop light/dark layouts at 100% and 200% text size with AAA text contrast. No real money, municipal messages or cloud resources are involved. `PLAYWRIGHT_MODULE` can select the installed Playwright module.

The existing private document bucket is required in a release environment. This work stays local until the user explicitly requests a deployment. The application does not provision permissions, allocate real reward funds or enrol municipal partners merely by enabling the UI.
