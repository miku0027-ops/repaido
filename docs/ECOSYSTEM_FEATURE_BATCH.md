# Repaido ecosystem development batch

This batch extends the existing transactional platform rather than duplicating
payments, rewards, booking or inventory authority. It is development work; a
successful local check does not publish the website or deploy Cloud Run.

## Customer entry points

- **Bookings → Your activity & saved items**: private activity across visits,
  hiring, orders, equipment rentals, Home plans, rides, contributions, support and
  home viewings. Actions reopen the relevant native workflow. The summary is a
  bounded sample of up to 50 records per type, not a complete financial ledger.
- **Bookings → Business & apartment accounts**: properties, staff permissions,
  independent approval, monthly property commitments, maintenance reminders and
  a consolidated statement of explicitly shared native records.
- **Market → Tool Rentals → Homes**: monthly home listings, city/budget/bedroom
  filters, property details, saved searches, owner submissions and private viewing
  enquiries. Equipment retains its existing reservation/deposit/custody billing.
- **Shop/professional profiles**: follow and return through Saved & following.
  **Product and second-hand/swap details**: save items and check current availability.
- **Cart → Orders**: add available products from an existing order to the cart at
  current prices, and open item-specific returns/support. Existing coupons and
  payment authorizations are not carried over.
- **Marketplace chat → Handover details**: agreed meeting, both-party completion
  and transaction-linked reviews after an accepted price or swap proposal.
- **Points & rewards → Missions**: join an operator-authored knowledge/reuse
  mission, submit owned evidence, follow its review and see verified points.
- **Product details → Find parts for your model**: bounded supplier-declaration
  matching with explicit uncertainty. A textual match is not certified compatibility.
- **Notifications and Saved**: opt-in saved-search, price-drop and following
  updates with timezone-aware quiet hours. These new optional updates are in-app
  inbox notifications; they do not silently enroll a device for external messaging.

## Existing capabilities retained

Native stock reservation, reservation expiry, equipment custody/returns, received
order confirmation, provider-verified payment/refund reconciliation, support
escalation/reopening, verified-purchase shop reviews, community points/coupon
wallets, service rebooking, supplier quotations and payout review remain canonical.
Existing operational push/email delivery keeps its authorization and retry rules.
Optional saved-update quiet hours do not suppress urgent booking or safety events.

## Requested feature coverage

| Capability | Implementation and entry point |
| --- | --- |
| Unified activity and next actions | New private activity hub in Bookings with links to native records; bounded sample disclosed. |
| Disputes, evidence, decisions, appeals and refunds | Existing service/rental flows plus private support photos, persisted targets and new purchase resolutions; money changes require provider evidence. |
| Notifications and quiet hours | Existing operational delivery retained; new optional inbox preferences for saved searches, price drops and follows. |
| Stock, reservations and expiry | Existing canonical checkout/rental transactions retained; CSV imports revalidate reserved stock and versions atomically. |
| Saved searches and availability alerts | New home search, home/product/used-item saves and durable opt-in matching queue. |
| Follow shops and professionals | New profile controls, current visibility checks and Saved & following. |
| Repeat bookings, reorders and shopping notes | Existing service rebooking; new current-price order-to-cart and private shopping notes. |
| Compatibility finder | New exact token matches against supplier-declared models, with uncertainty and native product links. |
| Rewards and coupon wallet | Existing shared ledger, budgeted coupon rules and checkout validation retained; reviewed mission contributions use the same points caps. |
| Shop business tools | New CSV import/export, low stock, response observations and evidence-based statements; existing native quotations/invoices/payout controls remain authoritative. |
| Community missions | New reviewed knowledge and reuse missions alongside existing scrap/cleanup lifecycle and contribution rewards. |
| Business/apartment accounts | New properties, invitations, roles, independent approvals, monthly budgets, reminders and consolidated actual-record statements. |
| Used-item and swap transaction tools | Existing negotiation/chat plus new saves/alerts, agreed meetings, mutual completion and transaction-linked private reviews. |
| Recommendation and campaign outcomes | Existing relevance/offer engines retained; new paginated downstream campaign outcomes grounded in bookings, verified payments/refunds and posted allocations. |
| House rental listings | New Homes destination under Rentals, moderated properties, photos, filters, saving and private viewing enquiries. |

This matrix distinguishes reused operational capabilities from newly added flows.
It does not claim automatic tax invoicing, automatic retail settlement, lease
execution, purchase conversion uplift or a measured production latency guarantee.

The existing recommendation systems retain consent controls, finite candidate
windows, evidence-based quality scores and synchronous authoritative pricing.
No fabricated scarcity, reviews, sales, margins, ownership guarantees or stock
availability are introduced.

## New operating workflows

### Home rentals

A verified-mobile owner uploads their own photo and supplies monthly rent,
deposit, locality, property type, bedrooms, furnishing, availability and terms.
A listing or edit is private until an operator reviews the photograph and details.
Owners can pause or mark a property let; republishing returns through review.

Customer enquiries propose a date and remain private to the visitor and owner.
Owners confirm or decline; visitors can cancel. Completed viewings and closed
threads retain their history. Version checks prevent stale updates; immutable
request IDs protect ambiguous retries. Publication does not verify land title.
This workflow does not collect rent/deposits or execute tenancy agreements.
House listings do not silently adopt equipment billing or the separate used-item
₹99 / shop-visibility ₹499 plans.

### Saved updates and following

Private saved entries retain references and a saved-price baseline. Display prices
and availability are resolved from current authorized source records. Published
home search matches are scanned through a durable bounded queue; previews disclose
their smaller sample. Followed shops/professionals and saved marketplace listings
are checked again when generating and reading updates. Removing a saved entry,
revoking consent or hiding a source prevents stale notifications from disclosing it.

The shared private worker drains the due queue; no new always-running service is
required. Entries have per-item cursors and due times, idempotent update records,
opt-out handling and quiet-hour deferral. See `backend/saved_alerts.py` and its
HTTP/domain tests for exact limits.

### Shops

**Shop workspace → Business tools** exposes CSV template/export, validated preview,
atomic versioned import, low-stock reporting, purchase-response observations and
owner-only financial statements. At most 25 inventory rows are committed per
reviewed batch. Imports use the same validation as manual stock edits and retain
existing reservations. Statements distinguish allocation, held/review amounts and
provider/journal-confirmed transfers; they do not manufacture supplier GST invoices.
See [shop tools](SHOP_BUSINESS_TOOLS.md).

### Businesses and apartments

The owner controls staff/manager/viewer membership through expiring invitations.
A request cannot be self-approved. Budget reservations are transactional and tied
to a property's intended month. Booking, quote acceptance and checkout remain
explicit native actions. Linking a record requires requester ownership and approval
coverage; later changes are shown for review. Internal approval does not charge
money or grant other staff control of a customer's private booking.

The statement separates actual issued records, verified payments, known refunds,
outstanding amounts and internal estimates. Maintenance reminders do not secretly
create bookings. See [business accounts](business-accounts.md).

### Outcomes and financial measurement

**Company → Global Control → selected campaign → Confirmed campaign outcomes**
connects promotion reservations to actual bookings, completions, cancellations,
verified final-balance payments, processed service refunds, complaints and repeat use within the
explicitly displayed sample. Budget/reserved amounts remain separate from revenue.

The report is paginated (25 reservations per page; up to 20 refunds and support
cases per booking). Settled company allocation excludes unpaid, incomplete, held
or refund-affected bookings. It is not net profit or a causal estimate of campaign
lift. Retail shop quality/sales observations continue to come from native received
orders, verified reviews and reversal-aware projections.

### Support, purchase returns and marketplace handovers

Support conversations accept up to five owned JPEG/PNG attachments per message.
Photos are authenticated and scoped to that case; metadata is removed, unknown
upload responses can be retried with the same upload ID, and sent attachments
cannot be silently rebound to another message. New cases persist response and
resolution targets (defaults 24 and 72 hours). Escalation preserves the targets;
reopening creates a new target period. Historic cases without timestamps say so.

Purchase resolutions preserve the actual item, quantity, paid amount and seller
disclosures at checkout. Customer, shop and operator actions remain distinct.
Approving a refund does not mean it has been sent; an uncertain provider result
is reconciled without blindly sending again. Existing allocations are held and
reviewed before any refund; transferred funds require separate recovery.

Marketplace meetings require both participants to agree to the same saved offer,
place and time. Completion requires both confirmations, protects against a second
handover of the same item and closes both listings for a swap. Reviews follow
mutual completion; this does not verify any off-platform payment.

Community missions are authored by operators and reward only independently
reviewed evidence through the existing non-cash contribution ledger. Public
knowledge requires contributor opt-in and can be withdrawn. See
[community and market lifecycles](COMMUNITY_MARKET_LIFECYCLES.md) for state,
review, privacy, refund and concurrency details.

## Infrastructure and release boundaries

- API/router modules use the existing SQLite/Firestore transaction authority.
  Identity/role checks run server-side; private operational collections remain
  denied to direct public Firestore clients.
- New equality lookups have local SQLite indexes. Saved-alert worker scheduling
  additionally requires the `ops_saved_alert_checks` composite Firestore index
  (active, next_check_at, document ID) in `firestore.indexes.json`.
- Publish that index and wait until ready **before an explicitly requested release**
  enables the matching worker/API. The current customer release classifier stops
  on index-file changes; this deliberate gate must not be bypassed.
- New modules are included in the shared backend container. API and private worker
  updates can share the build artifact; do not create a permanent microservice for
  each new button or read endpoint. Existing scale-to-zero worker configuration
  and event queues remain the operational model.
- Native photo/evidence storage uses the configured private bucket. Upload failures
  are actionable and do not create falsely complete records. No local fixture data
  or synthetic identities are production feature data.
- cPanel web publication, private-worker rollout, Firestore index publication and
  live account/provider tests are release actions, separate from local verification.

## Verification record

Final local verification on 2026-10-16:

- Entire backend: **1,300 tests passed**; 18 existing dependency/provider-library
  deprecation warnings, no failures.
- Frontend regression checks: **239 passed** (232 existing and 7 new native
  activity-navigation checks). The new checks are included in `npm test`.
- TypeScript and cPanel production build passed. The existing large-main-chunk
  warning remains; this batch does not establish a production loading-time SLA.
- **65 browser scenario groups passed** across Homes (9), business accounts
  (10), shop tools (4), saved alerts (8), support evidence (6), retail resolutions
  (11), campaign/compatibility (9), activity navigation (4), and real-API
  handover/mission lifecycles (4). Checks include narrow/mobile/desktop layouts,
  account changes, interrupted requests and accessibility audits.
- Container local-import packaging, generated selective-build configuration,
  index JSON validation and whitespace checks passed.

Most isolated browser scenarios use explicit API/auth fixtures; domain HTTP tests
exercise the real application against isolated SQLite databases. The handover
and community-mission browser groups run against the real local API with private
test storage and external payment/email/push delivery disabled. Live Firestore,
payment-provider, cPanel and Cloud Run verification is reserved for an explicitly
requested release. No production transaction was created during these checks.

The validation report and browser evidence are saved outside the repository at
`/workspace/releases/repaido-ecosystem-validation.json` and
`/workspace/releases/repaido-ecosystem-validation/`.
