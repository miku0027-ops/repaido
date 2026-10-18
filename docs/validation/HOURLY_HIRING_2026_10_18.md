# Personal hourly hiring: implementation and verification

This is an unreleased development change following the company admin redesign in `3eeaab5`. It does not describe a production rollout or live payment-provider certification.

## Accepted business rules

- Mandatory ₹150 booking base, collected upfront after the worker accepts the scope and the customer approves the quote. Actual work is billed at ₹2.50/minute (₹150/hour) afterward.
- Timing uses recorded server seconds, with money rounded once to integer paise. There is no started-hour rounding or minimum-hour charge.
- The customer selects a work ceiling, up to six working hours. One separate 30-minute meal break is unpaid. Parts-collection time is also unpaid. Unused reserved work time is not charged.
- A disclosed, locked demand surcharge can apply to **base plus work**, up to 25%. The upfront amount includes the base's surcharge and configured tax. It is credited once to the final invoice.
- Reservations more than one hour ahead use the standard rate. Within an hour, genuine occupancy among at least three eligible nearby professionals determines 0%, 10% (at least 60% occupied), 20% (at least 80%) or 25% (at least 95%). Unpaid hourly reservations do not raise demand prices. This provides a cheaper advance-booking option without reducing the compulsory base.
- No new travel surcharge is added to hourly hiring. Materials still require the existing approval/payment process. Legacy fixed-day bookings retain their original policy, coupons and amounts. Fixed-price coupons are explicitly unavailable for the new timed-work model.
- Applicable tax remains company-configured. Paid professional-listing pricing may remain unset during free eligibility; the system cannot create a membership payment with an unknown price.

## End-to-end behavior

The existing hiring request, worker acceptance, route verification and customer quote decision lead to a 15-minute payment reservation. Only a gateway-verified booking advance confirms the hiring and unlocks worker travel. An expired or cancelled reservation cannot be revived by a late capture; those funds are held for refund review.

The existing customer arrival code and work evidence gates start the timer. Both parties see recorded work, the agreed cap, break state, advance and service balance. A meal break pauses billing for at least 30 minutes and remains unpaid until the worker resumes. The server sweep caps abandoned clocks and notifies both parties; it does not fabricate completion or customer acceptance. Work submission replaces the service estimate with the actual charge while retaining separately approved materials. Customer sign-off creates the final invoice, less verified booking and parts advances. A fully prepaid invoice cannot take another payment.

Payments use a stable order intent, strict amount/currency/order binding and idempotent credits. Unknown provider results are reconciled instead of creating another order. Refund observations are monotonic, and a refund in progress remains a financial hold even if an unrelated support conversation closes. Booking advances, refunds and payout allocations use balanced journal entries. Support can resume an interrupted visit or close it at the recorded amount with customer consent; moving a paid hourly contract to another worker/date requires closure/reconciliation and a new reservation.

A worker may reserve a later nonoverlapping hiring while working. Scheduling includes the meal break and the existing 30-minute turnaround buffer, checks Home visits and projects, and rechecks capacity at acceptance, confirmation and payment allocation. Actual travel/start is blocked while another visit is active. Two sessions in a day are possible when the real schedule permits; neither earnings nor a precise release time is promised.

Professional profiles and Repaidians display coarse work state and an estimated next time rounded to five minutes. Customer locations, job IDs, phone numbers and movement trails are not public. Profile views refresh while visible; stale results are labelled. The frequent availability endpoint reads only active jobs, with a 101-record bound and an unknown-state fallback. Relevant category recommendations can show a compact next-slot panel for professionals actually working. Existing consent controls and ranking evidence remain in force.

## Architecture and release prerequisites

The implementation is a domain module in the existing backend container, alongside the existing hiring, operations, payment and support modules. It adds no always-on container or external billing service. `backend/Dockerfile` includes the module, and the selective build configuration check passes.

A new `ops_jobs(worker_id ASC, state ASC)` Firestore index supports the bounded availability query. A requested release must publish and verify this index before the API/frontend rollout. The API-only cPanel script deliberately refuses a batch containing rules/index changes; use the reviewed rules/full release workflow for this batch, rather than bypassing that guard.

Company admin's Hiring workspace can prepare a new hourly policy version. Confirm applicable tax and connected routing/payment providers, enable that version, and have workers accept its terms. Existing confirmed jobs retain their snapshots. No policy, credentials, production database, cloud runtime or website was changed during local implementation.

## Local validation

- Full backend regression: **1,530 passed**, 25 emulator-only skips, 18 existing warnings. Subsequent policy, demand and availability refinements passed focused regression checks.
- Focused hiring, discovery, recommendations, Repaidians, support recovery and packaging regression: **109 passed**. The hourly-specific suite then passed **28** cases, including the additional support/refund-hold regression.
- Final hiring, profile/recommendation and worker-calendar checks: **85 passed**, including the bounded-profile availability refinement.
- Web unit tests: **340 passed**, including the final feedback-text refinement.
- TypeScript/Vite production build passed, with existing bundle-size and lottie advisories.
- Real disposable HTTP browser flow: quote approval → verified ₹150 advance → verified arrival/work → unpaid meal break → work submission → customer acceptance → final payment. A 723-second work record produces ₹30.13 work, ₹180.13 total and exactly ₹30.13 remaining; provider fixtures receive orders for 15000 and 3013 paise.
- Worker modal accessibility passes WCAG A/AA checks at 320, 390 and 768px in light and dark themes, with no document overflow. Screenshots inspected for the new billing layout.
- Existing hiring-discovery browser suite passes responsive, dark, 200%-text, same-account refresh, account/sign-out separation and late availability/recommendation response checks.
- Firestore query structure is verified with the real SDK. Full Firestore transaction execution remains among the emulator-only checks; it was not run against production.

Browser evidence: `/tmp/repaido-hourly-hFryO1/` (customer confirmation, worker timer and final bill, request inventory). Logs: `/tmp/hourly-backend-final.log`, `/tmp/hourly-focused-release.log`, `/tmp/hourly-domain-final.log`, `/tmp/hourly-last-check.log`, `/tmp/hourly-web-last.log`, `/tmp/hourly-build-last.log`, `/tmp/hourly-browser.log`, `/tmp/hourly-discovery-browser.log`.
