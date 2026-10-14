# Scrap and community cleanup

The customer Sell scrap destination now has Sell my scrap, Report litter and My rewards. Sales retain the existing inspection, net weighing, customer-approved quote and receipt flow. Public reports are a separate lifecycle: a report does not establish ownership or authorise removal of public property.

## Roles and workflow

1. A signed-in customer submits 1–3 private JPEG/PNG photographs, a confirmed map pin, landmark/city, material category and description. Photos use the existing private document service and its image validation/size limits.
2. An administrator opens **Transport & scrap reviews → Community cleanup reports & cash rewards**. Approval requires a collection-permission reference. Hazardous reports cannot be approved for ordinary collectors; an actual specialist-authority referral reference can be recorded instead. This does not contact a municipality automatically.
3. An optional cash reward is approved from **Repaido funds**. The admin records the funding approval reference. No reward is inferred from weight, scrap resale value or a market rate. The initial per-report approval cap is ₹1,000; zero is valid. This is a manual budget approval record, not a bank-balance check or transfer.
4. A current, approved scrap collector within 8 km can accept the report through **Community cleanup** in the collector suite. Assignment is exclusive. A collector can release an unsubmitted task with a reason; an admin can reopen an assigned or submitted task for reassignment. Existing reward approval stays unchanged, and the new collector must submit fresh completion evidence. Reporters can collect only when the independent-contributor permission described below is explicitly approved. An admin cannot approve or verify a report they submitted or collected.
5. The collector submits new after photographs and the recycling/disposal destination, from a recent device position within 300 metres of the site. Device location is a proximity check, not proof against GPS spoofing. Administrators must inspect the evidence and permission.
6. Admin verification completes the cleanup and awards 10 non-cash points exactly once. Rework returns the report to the collector and requires fresh evidence. Rejection/referral/cancellation earns no points. Captain Gold requires 100 qualifying points earned in 30 days; these are initial product rules, not market or government standards.
7. After actual cash handover, an admin records the cash receipt reference. Only the reporter confirms receipt. A payment concern blocks receipt completion until an administrator records their investigation; the reporter still confirms receipt themselves. No payment gateway or automatic disbursement is used.

“Swachh Bharat Captain” is explicitly a Repaido community badge, not government certification. Cash is not described as tax-exempt. Applicable accounting and tax treatment remains an operational responsibility.

## Privacy, integrity and operational limits

- Evidence is private to the reporter, assigned collector, approved nearby candidates at the approved stage, and authorised administrators. There is no public photo feed, reporter contact directory or public exact-location leaderboard. The optional city leaderboard described below never includes report locations.
- Customers are asked not to photograph faces/number plates or touch hazardous material. Hazardous material follows the referral path.
- A 30-metre same-city open-report check and transaction guards prevent ordinary duplicates, including racing submissions. This is not image-content duplicate detection; moderators still check repeat/reused scenes and incorrect cities.
- Uploaded evidence IDs cannot be reused across reports or as new completion evidence. Each authenticated user can submit at most five reports per day. The underlying private-upload throttle remains in effect.
- Commands use expected versions and idempotency keys; completion and points writes occur in the same transaction. Reward status and points are independent, so an unpaid cash reward cannot look like a confirmed receipt.
- SQLite adds lookup indexes; Firestore uses the existing server-only `ops_*` store with single-field lookups. The admin queue fetches at most 51 records per page and separates active/history. Closed admin panels do not poll. Mounted views refresh quietly every 30 seconds and pause scheduled refreshes in background tabs.
- Customer and collector lists currently display their latest 100 records. Lifetime totals include the complete earned ledger; qualifying and ranking points follow the rules below. Large-scale regional dispatch, public content sharing, automatic authority integrations, accounting exports and configurable campaign policies are not part of this version.

## Validation and release

`backend/.venv/bin/python -m pytest backend/test_cleanup.py backend/test_local_business.py -q` checks lifecycle, privacy, competing assignments, racing duplicates, replay/version handling, fresh geofence/evidence, referral, payment disputes, badge thresholds, throttling and admin pagination.

With local Vite on port 5187, `web/tests/cleanup.browser.mjs` uses a disposable SQLite API and private in-memory image storage to exercise the real customer/admin/collector UI. It checks actual image upload, map confirmation, approval, GPS completion, verification, cash receipt, and mobile/desktop light/dark layouts at 100% and 200% text size with AAA text contrast. No real money, municipal messages or cloud resources are involved. `PLAYWRIGHT_MODULE` can select the installed Playwright module.

The existing private document bucket is required in a release environment. This work stays local until the user explicitly requests a deployment. The application does not provision permissions, allocate real reward funds or enrol municipal partners merely by enabling the UI.

## Cleanliness Club and Gold (unreleased)

Sell scrap → **My rewards** groups impact, cash receipts, local leaders and offers. Profile → **Account & privacy → Profile photo & leaderboard privacy** uses a separate owned photo upload. Public participation is off by default. Opting in publishes only display name, optional portrait, city ranking, verified-cleanup count and Gold status. A separate public avatar route checks the current opt-in and photo every time; leaving revokes that route. Report evidence cannot be used as a profile photo. Profile writes use versions and equivalent retry recognition.

An administrator may explicitly allow the reporter to perform a safe cleanup themselves when approving the site. Without that approval, self-assignment remains forbidden. The contributor then accepts, submits fresh after evidence and a disposal destination at the site, and waits for independent review. This does not authorise hazardous handling or removal of public property without permission.

### Points and evaluation

`captain_rewards.py` owns the server-side policy. Each independently verified cleanup earns 10 points, with at most five scored verifications per India-calendar day. Reporting, viewing, uploading, paying cash and joining the leaderboard do not earn points. New awards record 18 integrity checks: independent review; collection permission; public-place declaration; safe category; before evidence; after evidence; distinct photos; upload ownership; report evidence claims; authorised collector or approved contributor; disposal record; review note; 300 m proximity; accuracy within 100 m; fresh capture at submission; verification after submission; single award per report; daily scoring limit.

Six further evaluation inputs determine membership and rankings: rolling 30-day earned points, each award’s age, the next 30-day decay period, the retained 30% floor, verified contribution days and lifetime verified cleanups. These are deterministic checks and measures, not claims of AI fraud detection or twenty independent evidence sources. Location spoofing and duplicate photo contents still require human review. No score depends on earnings, device cost, demographics or promotional engagement.

- **Qualifying points / Gold:** only awards less than 30 days old count. At least 100 are required. The API returns the next Gold-expiry time and checkout always rechecks eligibility.
- **Ranking points:** each award retains 100% for 30 days, then decays linearly over the next 30 days to 30%. New activity never resets the age of old awards. Sum first, then floor the displayed ranking total.
- **Lifetime points:** original earned amounts remain in history.
- Ties use verified contribution days, then verified cleanup count, then a stable opaque identifier. The city comes from the latest verified cleanup, not an editable profile field. The top 50 opted-in members and the caller’s rank are returned.

The account-scoped UI uses quiet cached reads, a five-minute membership refresh and a two-minute visible leaderboard refresh. Gold navigation also expires locally using the server time. No periodic save or completion toast is generated. Profile upload/save emits one completion notice. Motion is finite and honours device/app reduced-motion preferences.

### Offers and accounting

User-confirmed rules: repair visiting fees stay at **30%** (not 50%); one use of each offer per rolling 30 days; no stacking. The first shared ride is **50%**, cab base fare **50%**, and tool/heavy-vehicle rentals **10%**. Those four offers have **no approved rupee cap yet**, are labelled “Terms being finalised” and cannot be reserved. Their service checkout adapters must be completed with the caps; changing a cap alone is not a release-ready integration. Never discount an entire repair instead of its visiting fee or silently reduce the ₹500 cab minimum/advance.

The available **CAPTAINREFURB25** offer gives 25% off the declared pre-tax base of refurbished appliances, capped at **₹1,000**. Eligibility uses an exact approved catalogue-category allowlist; unrelated refurbished products and new items are excluded. The reservation, stock adjustment and immutable price snapshot share the order transaction. A reservation consumes that offer for 30 days; retrying the same order preserves its price and never consumes a second use. Existing manual order/refund reconciliation remains necessary for abandoned or disputed payments.

This discount is funded by Repaido: customer payment falls by the discount, the shop payable retains the original item amount, and the balanced ledger records a `community_reward_expense` debit. It is separate from vendor-funded welcome coupons and from manually approved cleanup cash rewards. No automatic payout, new cloud budget or subsidy cash transfer is provisioned here.

Current city rankings compute from city-indexed participant projections; they are not a load-tested million-user leaderboard. Before very large city campaigns, use a scheduled materialised ranking service and compact/archive old award projections. This release makes no million-requests-per-second claim.

Additional verification: `backend/test_captain_rewards.py` covers decay boundaries, cap locks, competing redemptions, replay, profile ownership/privacy/opt-out, independent contributors, category restrictions and full seller entitlement. The browser flow includes real portrait upload, leaderboard opt-in/out, Gold and locked offers across light/dark themes, 320/390/584/1440 px widths and 100/200% text sizes with AAA text contrast checks.
