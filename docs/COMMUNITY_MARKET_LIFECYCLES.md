# Community contributions, marketplace handovers and retail resolutions

These features use saved participant actions and independent review. There are no
seeded missions, fabricated completion counts, inferred payments or new cash
reward funds. Development and tests remain local until an explicit release.

| Requested behavior | Existing or added implementation |
| --- | --- |
| Public cleanup and scrap contributions | Existing `cleanup.py`, `captain_rewards.py` and scrap collection workflows retain permission, private evidence, independent review or mutual weighed-payment confirmation, and funded reward controls. |
| Repair knowledge and reuse drives | `community_missions.py` adds operator-authored missions, immutable scope at joining, explicit submission deadlines, owned private photos, review, rework with a new deadline, rejection and a single appeal. |
| Contribution rewards | Mission verification uses the existing `record_contribution` ledger: up to 10 non-cash points, one award per contribution, and the shared 50-point daily maximum across all contribution types. It creates no cash payment. |
| Knowledge sharing | Publication requires contributor opt-in and an operator's completion review. Public text excludes account identifiers and photos; the contributor can withdraw publication without losing their verified contribution. |
| Price and swap negotiation | Existing accepted/declined price and owned-item swap proposals remain in the private market chat. |
| Meeting and mutual completion | `market_transactions.py` snapshots an accepted offer, requires agreement to the current place/time, resets agreement when rescheduled, accepts each participant's actual handover confirmation, and atomically closes one or both listings only after both confirmations. |
| Transaction reviews | Each participant can leave one private rating and review only after both handover confirmations. The receipt explicitly distinguishes participant confirmation from independent payment verification. |
| Service disputes, refunds and appeals | Existing `lifecycle.py` and `refunds.py` provide private support, financial holds, escalation/reopening, reviewed adjustments and provider-confirmed refunds. Support evidence and configurable response targets are documented with the support workspace. |
| Rental returns and disputes | Existing `rentals.py` retains custody/return checks, inspection disputes, operator review and provider refund reconciliation. |
| Shop purchase returns and disputes | `retail_resolution.py` adds item/quantity-linked cases, frozen seller disclosures, private evidence, shop replies, return instructions, actual shop receipt, independent decisions, appeals and guarded provider refunds. |

## Customer and operator workflows

**My rewards → Missions** shows current published missions and the caller's own
contributions. Joining saves the title, requirements and deadline accepted at
that time. Later operator edits affect new contributors. A resubmission requires
new owned photos; the previous review and evidence references stay in history.
Company mission management publishes scopes and reviews evidence. Merely
joining, submitting, posting or receiving a rejection earns no points.

Marketplace conversations include **Handover details**. An accepted proposal is
required to schedule a meeting. The proposer agrees first; the other person must
agree to that exact version. Rescheduling cancels the previous agreement. Each
person confirms only after the meeting time and actual item/payment exchange.
The first confirmation claims the item in that conversation, preventing a
competing handover from completing the same item. After the second confirmation,
the listing closes; swaps close both listings in one transaction. Existing
handover completion and history remain accessible after membership expires.
Use the conversation report for disputes after a confirmation. Completion never
charges a payment instrument or marks a provider payment verified.

Shop orders expose **Returns and support** per purchased item. A request always
requires order ownership and verified payment. Its refund ceiling is the actual
customer-paid amount for the requested quantity, after discounts. New checkouts
freeze the seller's declared return and warranty terms; older purchases without
a snapshot go to manual review. A seller-disclosed deadline is informational:
the system does not invent an entitlement or automatically refuse a request
outside that window. Customer/merchant evidence can be read only by the two
parties and authorised operators.

The shop can reply, authorise a return with instructions/deadline, and confirm
actual returned-item receipt with evidence. The customer can record sending the
item and appeal one closed decision. A return refund needs the shop's actual
return receipt. An operator can independently approve a reviewed amount, reject
the request, or resolve it without a refund. Response/resolution times use the
configured support targets and are labelled as targets rather than guarantees.

## Refund and concurrency controls

Opening a retail case marks the order and unsent item allocation for financial
review. A payout batch or transferred allocation blocks a refund until separate
financial recovery is completed. The original allocation must match the exact
order and shop, and its current amount plus recorded refunds must match the
frozen purchase. A posted, balanced, unreversed capture journal must also match
the payment and any company subsidy. Unrelated financial holds survive closing
a case. The approval is distinct from the explicit
operator action that sends the refund. The send action verifies the provider's
payment ID, order ID, currency, captured amount and existing refunded balance.
It reserves a refund intent before external I/O, serialises concurrent order
refunds, and never repeats a POST after an uncertain response. Subsequent checks
look up the exact reserved receipt. A provider failure needs another reviewed
approval before a new intent; absence from a lookup is not treated as failure.

Only an exact processed provider receipt, corroborated by the payment's refunded
balance, posts the balanced refund journal. It reduces the original shop payable
and reverses the proportional Repaido subsidy when one funded the purchase.
The order retains `state=paid` for partial refunds and becomes `refunded` only
when its full customer payment is refunded. `amount_refunded`, `refund_pending`,
`refunded_at`, `financial_hold`, `return_requested` and `complaint_count` are
saved source fields for operational reporting. Returned goods are not silently
restocked; the shop must inspect them and confirm the physical inventory count.

Mutation requests use version checks and stable request receipts. New reads use
bounded equality queries and ID cursors. Community/retail field indexes are
registered in `operations.py`; handover receipts use point lookups. Private
evidence is never copied into notifications or public profiles.

## Local verification

Run `backend/.venv/bin/python -m pytest backend/test_market_transactions.py
backend/test_market_messaging.py backend/test_community_missions.py
backend/test_captain_rewards.py backend/test_cleanup.py
backend/test_scrap_rewards_ecosystem.py backend/test_retail_resolution.py
backend/test_retail_checkout.py -q` and `npm --prefix web run build`.

The HTTP suites use isolated SQLite databases and provider fixtures. They check
foreign-account access, evidence ownership, retries, stale versions, competing
handover claims, both sides of swaps, unchanged scope at joining, review appeals,
shared points limits under concurrency, purchase policy snapshots, return receipt
requirements, allocation holds, exact refund/subsidy journals, captured-balance
checks and uncertain-provider recovery. They do not transfer live money.

Run `node web/tests/ecosystem-lifecycles.browser.mjs` from the repository root for
the real-API browser suite. It starts an isolated SQLite API on port 8087 and
Vite on port 5201, uses production endpoints, and substitutes only local identity
and object storage. External delivery and payment providers are disabled. A
test-only clock seam moves the mutually agreed meeting into the past. The suite
checks offer acceptance, agreement, visible early-completion feedback, both
handover confirmations, private review, mission publication, joining, owned
photo upload, independent review and exactly one Captain points award. Four
surfaces are checked at 320, 467 and 1280 pixels and audited with axe. Override
`ECOSYSTEM_API_PORT`, `ECOSYSTEM_VITE_PORT`, `ECOSYSTEM_TEST_ORIGIN` or
`PLAYWRIGHT_MODULE` when the local environment requires different ports or a
different Playwright installation.

`web/tests/retail-resolutions.browser.mjs` exercises the customer, shop and
operator UI with intercepted API fixtures, including uncertain request retries,
return receipt evidence, independent approval and a separate refund submission.
Its eleven checks include mobile layouts, axe and cart identity-switch/repeated
click regressions. The backend HTTP suites establish refund accounting; the
browser fixtures verify the interface without contacting a payment provider.
