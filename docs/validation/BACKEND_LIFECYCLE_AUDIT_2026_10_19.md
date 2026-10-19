# Backend lifecycle audit — 19 October 2026

Scope: the customer ecosystem requested in this thread, checked against local
source based on `7472593`. This report describes executed checks and source
review, not a production deployment or a promise that customer complaints are
impossible. The existing environment and dependencies were reused; credentials,
feature flags, production records and deployment configuration were not changed.

## Confirmed defect and changes

An order-creation request can remain in flight while another request or the
existing reconciler recovers its unique provider receipt and verifies payment.
Several older attachment paths then unconditionally wrote `status='created'`
when the first provider request returned. This could replace an already verified
`captured` or `refunded` state, blocking a paid rental handover or losing the
refund state used by payment allocation.

The rental deposit regression reproduced both cases before the fix: **2 failed**
because the final saved state was `created` rather than `captured`/`refunded`.

Changes:

- `integrations.attach_saved_order` now reads the current payment inside the
  transaction, rejects a conflicting provider order and advances only `creating`
  to `created`. It preserves verified payment/refund fields and states.
- The final task invoice, approved parts advance, monthly Home invoice, legacy
  hire-membership and worker-network fee attachment/recovery paths use that
  helper. This also removes a stale whole-record write in hire-fee recovery.
- Transport advance/balance order attachment uses the same helper and rejects
  an order mapping already assigned to a different payment.
- Rental order creation and recovery share validated attachment: the amount,
  currency, receipt and order identity must match, and later verified states
  remain unchanged.
- HTTP lifecycle regressions exercise recovery and capture/refund **before the
  original order POST returns** for rental deposits, final task balances, parts
  advances, transport payments and monthly Home invoices. They check one order,
  retained credit/refund state and applicable handover gates. Service, parts and
  Home tests also replay a stale capture after a refund.

Prices, billing rules, trial durations, custody approvals, independent dispute
review and provider-verification requirements are unchanged.

## Coverage matrix

| Area | Local behavior exercised | Relevant suites |
| --- | --- | --- |
| Used items and swaps | Listing visibility, verified participant access, accepted offers, transactional handover claims, two-party completion, reviews, privacy and retry safety | `test_marketplace`, `test_market_messaging`, `test_market_transactions`, `test_market_profiles` |
| Marketplace access | One server-owned 90-day trial, ₹99 paid month, provider-bound grants, duplicate payment prevention, refund tombstones and renewal visibility | `test_market_access` |
| Chat activity | Conversation-scoped online/typing expiry, ordered heartbeats, multiple sessions, blocked participants, private shop active-day aggregates | `test_market_presence`, `test_market_notifications` |
| Shops and spare parts | Registration/access state, 90-day trial and ₹499 month, default trial discount and owner offers, public profile/catalogue visibility, ranking/discovery, inventory and payment/payout boundaries | `test_shops`, `test_shop_access`, `test_shop_pricing`, `test_shop_parts_pricing`, `test_shop_discovery`, `test_shop_payouts`, `test_parts_advances`, `test_procurement` |
| Rentals and housing | Stock competition, approved terms, deposit-gated coded handover, actual duration, coded return, quarantine, damage review/refunds/payouts; property moderation, owner/enquirer authorization and viewing transitions | `test_rentals`, `test_housing` |
| Hourly personal hire | ₹150 booking base paid upfront, actual work at ₹2.50/minute, maximum 360 work minutes, separate unpaid 30-minute meal break, agreed total surcharge capped at 25%, final advance credit, future availability/privacy, competing reservations and late/refunded payments | `test_hourly_hiring`, `test_hiring_records`, `test_hire_discovery`, `test_hire_recommendations` |
| Cab, self-drive and shared rides | Quote snapshots, first acceptance/driver capacity, advance gate, route/location consent, fresh GPS and uncertainty-aware 300 m destination boundary, drop-off and completion, duplicate notification delivery and cancellation/refund behavior | `test_local_business`, `test_mobility_journeys`, `test_shared_destination`, `test_shared_departure_alerts`, `test_public_cab_availability`, `test_transport_discovery` |
| Customer contract requirements | Safe agent/related-trade discovery, private scope/site/proposals, city/skill matching, legacy query-reference repair, contractor bidding, customer award, workforce capacity and lifecycle authorization | `test_custom_contracts`, `test_custom_contract_discovery`, `test_custom_contract_integration`, `test_contract_hiring_lifecycle`, `test_contract_capacity` |
| Recurring Home and service finance | Mutual plan acceptance, scheduling, visit work/proof/checklists, monthly invoices, completion review, settlement conservation, cancellation/refund holds and outbox delivery | `test_home_plans`, `test_operations`, `test_lifecycle`, `test_integrations`, `test_transactional_records` |
| Repaidians and wider ecosystem | Membership, private messages, media/content/live access, network/work opportunities, role policy, reports, account isolation, rewards/offers, retail checkout and HTTP/security boundaries | Remaining suites in the complete backend run |

The matrix summarizes existing tests plus the new payment-race regressions. It
does not claim that every possible user action or every third-party outage has
been exhaustively enumerated.

## Executed validation

Complete backend run after the changes:

```bash
NO_GCE_CHECK=true backend/.venv/bin/python -m pytest -q -rs backend
```

Result: **1,551 passed, 25 skipped, 18 warnings** in 121.53 seconds. All 25 skips
were the explicit loopback-Firestore variants in `test_legacy_bookings.py`.

Those skipped server-transaction cases were then run with the existing trusted
Firestore emulator JAR, isolated on `127.0.0.1:8197`, anonymous credentials and
unique `demo-repaido-booking-*` test projects:

```bash
FIRESTORE_EMULATOR_HOST=127.0.0.1:8197 NO_GCE_CHECK=true \
  backend/.venv/bin/python -m pytest -q backend/test_legacy_bookings.py -k emulator
```

Result: **25 passed, 26 deselected, 55 warnings** in 36.70 seconds. These include
competing checkout requests, transaction rollback, late payment rechecks and
preventing refunded bookings from being recreated. Across the two runs, every
collected backend case executed successfully. Warnings are existing dependency
deprecations and positional Firestore query-filter warnings.

Additional checks during diagnosis:

- 27 selected core lifecycle suites: 382 passed before new regressions.
- Rental, shop payout and coupon checks after the first race fix: 33 passed.
- Focused new checks: final/parts races 4 passed; transport races 2 passed;
  monthly Home lifecycle variants 3 passed.
- `git diff --check -- backend`: passed.

Local logs are under `/tmp/backend-entire-audit-final-20261019.log`,
`/tmp/backend-firestore-audit-20261019.log` and the focused `*-order-race*.log`
files. The initial failing rental reproduction is in
`/tmp/rental-order-race-before.log`.

## Production boundaries

### Retained legacy booking checkout limitation

The earlier legacy checkout release gate remains open. The registered
`POST /checkout/booking/order` API creates a provider order without reserving a
slot (`backend/main.py`, `create_booking_payment_order`).
`POST /checkout/booking/verify` first verifies an already captured payment, then
checks the future appointment and available capacity in its local transaction
(`backend/main.py`, `verify_booking_payment`;
`backend/legacy_bookings.py`, `complete_paid_booking`). A full slot returns 409,
"This time just filled up. Choose another slot." An expired appointment returns
409, "This appointment requires reconciliation. Choose an available future
time." A changed payment/order also returns 409 for reconciliation.

On failed fulfillment, the provider may have captured funds while the local
`payment_orders` record stays `created` and no booking is written.
`test_paid_capacity_failure_preserves_payment` explicitly verifies that retained
state. These passing tests prove the allocation guard and transaction rollback;
they do not establish successful customer recovery after capture.

Retrying the **same** verification proof can resolve a transient conflict or a
slot that becomes available again before it expires. Permanent full/expired or
changed-order failures require support/provider reconciliation and, when needed,
a reviewed refund. There is no automatic legacy refund/reconciliation worker:
the operational refund worker reads separate operational `jobs`/`payments`, not
legacy `payment_orders`. The same order cannot simply be assigned a new time by
the public verification API because its accepted metadata is immutable.

The retained `liveConfirmBooking` callback in `web/src/App.tsx` holds the order
and payment proof only in that asynchronous call. Invoking it again creates a
fresh request UUID and provider order; it has no durable customer payment-recovery
intent. Therefore a customer retry through that legacy callback could prompt a
second charge after an earlier capture. Permanent failures must be reconciled
before initiating a new charge. The generic checkout error alone is not a
complete recovery flow.

The normal active catalogue passes `onBook` to `CatalogApp`, which bypasses its
legacy checkout and opens the native operational booking flow. This reduces
exposure through that current UI path; it does not remove the registered legacy
APIs or close their recovery gap. The payment-attachment fixes in this audit do
not change this retained legacy behavior.

### External services and release checks

Payment, route, storage, OTP, push/email and payout providers were replaced with
test-only responses. Real money, live customer accounts and production delivery
were not exercised. The emulator verifies local transaction behavior; it does
not establish deployed Firestore indexes, IAM, rules/version parity, regional
latency or production data quality. Client rules are separately audited by the
Firestore readiness task.

These results support the tested local state transitions, pricing, isolation and
retry behavior. Production release smoke tests, configured service readiness,
real-device GPS/background delivery and observability remain release checks.
The changes in this audit are **not deployed**.
