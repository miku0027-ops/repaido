# Customer and Repaidians quality review — 19 October 2026

This review starts from `7472593` and covers the customer app, Repaidians and their backend lifecycles. Changes and verification are local. Nothing was pushed or deployed, and no real customer record, charge, refund, message, provider setting or credential was changed.

## Design assessment and changes

The previous version was not a finished quality ceiling. This pass used concrete product criteria: readable hierarchy, clear action outcomes, published prices before requesting, progressive disclosure, familiar navigation, complete words at enlarged text sizes, usable touch targets, keyboard access, consistent themes, recoverable failures and bounded motion. An automated contrast pass alone did not establish a good layout: visual inspection and whole-word geometry checks found additional issues.

- **Social layout:** Repaidians now has a quieter header, labelled Home/Search/Videos/Work/Profile navigation and a persistent Liked feed. “Videos” distinguishes short work videos from finding work. Stories and trade controls are smaller; captions do not repeat the author already shown above them. Cleanup actions remain accessible through a keyboard-operable disclosure. The location prompt takes one compact row. In the same 390 px fixture, the first post begins around 463 px rather than 654 px, recovering about 191 px.
- **Customer decision clarity:** repair results show the exact currently selected service and its published fee before Request. Alternatives show their fees and submit the actual chosen service and professional. Skills and secondary review criteria remain available through disclosures. Quick-search actions retain 44 px targets, and repeated component instances have unique input IDs.
- **Homes:** rental destinations, property actions, filters, cards, messages and forms now use the shared light/dark palette and relative text sizes. Controls wrap as whole actions rather than splitting words into letters. Narrow screens and 200% text can use more vertical space to remain readable.
- **Customer navigation:** all five destinations remain visible at ordinary phone text sizes. Larger text can scroll within a dedicated navigation row, preserving whole labels and reachable actions. The separate Help button stays above the outer dock. Selection, keyboard focus and viewport/text-size changes reveal the relevant destination.
- **Discovery reflow:** the real customer app's three Rides/Repairs/Market modes and embedded ride/market submodes keep whole labels and reflow when enlarged text needs more room. The decorative greeting signature also moves below the greeting instead of squeezing its words outside the card. These cases were found by inspecting screenshots beyond the original page-overflow checks.
- **Motion:** transitions remain short and decorative. System/app reduced motion stop the decorative frames and slideshow; the paused control explains its state. No artificial live presence, invented ratings, fake discounts or urgency counters were introduced.

These changes improve measurable usability and consistency. This review does not establish that the app is the “best in the world,” nor does it replace user research, physical-device testing or manual assistive-technology evaluation. The separate Repaidians app remains a future packaging project; this pass improves its existing social module without claiming an App Store or Play Store release.

## Verified functional corrections

| Finding | Resulting behavior |
| --- | --- |
| A late provider order response could overwrite an already captured or refunded payment | Transactional attachment preserves current payment/refund state and rejects conflicting orders. Fixed across rental, transport, task balance, parts, monthly Home and legacy membership-fee paths. |
| Dragging or selecting text from inside a dialog onto its backdrop could dismiss the dialog and discard a draft | Dismissal requires a genuine press and release on the backdrop. Explicit Close, nested focus containment, Escape and focus restoration remain available. |
| A reused location picker could show a new map with old controlled coordinates or accept an old GPS callback | Each opening resets map, fields and confirmation together. Closed-session GPS and results older than a manual edit are ignored. |
| Cancelling live video before its offer response could leave a subsequently discovered server session open | Late session resources are deleted exactly once; cancelled connections stop promptly and closed peers stop emitting user-facing callbacks. |
| A previous city's pagination response could join a new requirement list; pagination could overlap a visibility refresh | Discovery uses a scope-specific lifecycle and a shared request lock. Account/city changes retire the old view, access loss clears cards, and manual refresh retains the current list while loading. |
| Every customer downloaded worker/admin code at entry | Worker, administration and partner-registration modules load on demand. Slow downloads show a status; failed workspace downloads show recovery and back actions. |

The built initial JavaScript gzip estimate fell from 818.41 kB in the previous build to approximately 767 kB, about 52 kB (6%) smaller. The production browser check verifies that customer entry does not request the deferred worker/admin/registration chunks, that actual worker/company/shop entry routes load, and that a failed worker chunk returns a recoverable screen. The remaining entry bundle and CSS are still large; this is an improvement, not a claim that application-wide performance work is finished.

## Evidence and coverage

- Full backend: **1,551 passed, 25 emulator-only skips**. All **25 skipped transaction cases passed separately** against the loopback Firestore emulator, so 1,576 collected backend cases executed successfully across the two runs.
- Firestore client authorization: **96 assertions passed** against an isolated demo project.
- Frontend logic: **345 passed**, none skipped.
- TypeScript and production Vite build: passed.
- Customer screen audit covers 84 destination/theme/text variants, including 320 px with 200% text. It checks whole navigation words as well as fonts, document overflow and automated enhanced contrast.
- Focused browser regressions cover real local customer booking and receipt, explicit private-safe feed publication, Home request stages, marketplace offers/swaps and two-party handover, property interfaces, hourly advance/break/balance, shared rides, social publishing/media/profile/follow/comment flows, private messaging, account changes, delayed reads, unavailable services, modal drafts, GPS callback ordering, contract discovery and actual production chunks.

Detailed backend coverage, commands and finance boundaries: [backend audit](BACKEND_LIFECYCLE_AUDIT_2026_10_19.md). Independent browser coverage and provider/fixture distinctions: [journey QA audit](JOURNEY_QA_AUDIT_2026_10_19.md).

Browser passes were collected throughout the review; affected checks were rerun after their corresponding fixes. They are not presented as one exhaustive run of every possible screen against production.

Additional local logs include `/tmp/repaido-senior-web-final.log`, `/tmp/repaido-senior-contracts.log`, `/tmp/repaido-contract-refresh-audit.log`, `/tmp/repaido-async-workspace-audit.log`, `/tmp/repaido-workspace-bundle-audit.log`, `/tmp/nav-brand-final.log`, `/tmp/nav-compact-final.log` and `/tmp/customer-discovery-submode-reflow.log`. The final build is recorded in `/tmp/repaido-senior-build-final.log`. Other browser artifact paths are recorded in the two linked reports. Focused backend and frontend runs overlap the complete suites and must not be added again as unique tests.

Browser harness corrections preserve substantive assertions: waits now observe actual rendered records or specific held requests instead of global network idle; fixture hiring policies include the required billing model; discovery tests choose their intended tab explicitly. An old development server exiting was an environment failure and was rerun. A supposed plain-text-post issue was rejected as unproven because the publishing rules require media or a verified reference/milestone; that policy was preserved.

## Remaining production limits

1. **Retained legacy checkout recovery:** the old `/checkout/booking/*` API can capture money before final capacity allocation. A permanent full/expired-slot failure still needs support/provider reconciliation or refund; there is no legacy automatic-refund worker or durable recovery UI. The active catalogue uses operational booking instead of this retained callback. A fresh legacy checkout must not be presented as recovery for an already captured order. Details and source references are in the backend audit. Passing its rejection tests does not make this a recovered payment journey.
2. **Live providers and deployment:** local adapters do not prove production OTP, Razorpay capture/refund/payout, webhook convergence, streaming infrastructure, routing-provider availability, push/email delivery, deployed IAM/index/rule parity or load behavior. These need release-environment checks and monitored production evidence.
3. **Devices and distribution:** this pass does not certify Safari/iOS, physical-phone GPS accuracy, background delivery, Android/iOS store packaging or a standalone Repaidians application. Keyboard and automated accessibility coverage do not substitute for complete manual screen-reader testing.

The corrected local paths are verified within these boundaries. No promise of zero customer complaints or universal production success is made. Current code remains on the development branch pending a separately requested release.
