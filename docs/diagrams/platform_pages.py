"""Source-derived application, data, event and observability pages.

The route inventory is generated from the FastAPI routers in an isolated SQLite
process. This renderer performs no cloud calls and never handles credentials.
"""
from __future__ import annotations

import collections
import html
import json
import math
from pathlib import Path


HERE = Path(__file__).resolve().parent
INVENTORY = json.loads((HERE / 'api_inventory.json').read_text())['routes']
ENGINEERING_ROUTES = [
    {'service': 'console', 'method': 'GET', 'path': '/health', 'module': 'engineering.server.app'},
    *({'service': 'console', 'method': 'GET', 'path': '/engineering-api/' + name,
       'module': 'engineering.server.app'} for name in
      ('config', 'blueprint', 'snapshot', 'source', 'stream')),
]
ROUTE_ROWS = sorted(INVENTORY + ENGINEERING_ROUTES,
                    key=lambda row: (['main', 'work', 'worker', 'console'].index(row['service']),
                                     row['module'], row['path'], row['method']))
ROWS_PER_PAGE = 30


TOPICS = [
    {
        'title': '01  Runtime topology and trust boundaries',
        'subtitle': 'HLD: four browser experiences share one Hosting deployment; API routing and authorization remain server-owned.',
        'nodes': [('Customer + business SPA', 'Web/Android surfaces; persona-specific panels'),
                  ('Firebase Hosting', 'Same-origin assets and ordered /api rewrites'),
                  ('Cloud Run APIs', 'Main + work API; private worker separate'),
                  ('Firestore + media', 'Authoritative records and owned objects'),
                  ('External services', 'Firebase, Razorpay, Routes, Cloudflare when configured')],
        'details': [
            ('Entry and dispatch', 'The web shell serves customer, agent, contractor, cab owner, driver, scrap collector and administrator experiences. /worker modes are presentation and business-role choices, not a separate authorization layer. Specific /api/repaidians/work, companies and placements rewrites precede the generic /api/** rewrite.'),
            ('Three API runtimes', 'repaido-api mounts the broad operations and community routers. repaido-work-api mounts the work discovery router and has bounded admission. repaido-work-worker exposes only health and private dispatch. The latter does not run the main API lifespan scheduler.'),
            ('Shared state boundary', 'Production code selects Firestore; local tests can select SQLite. Both public APIs and the private worker use the existing transactional record adapter. Splitting runtime deployment does not imply separate databases or independently owned data schemas.'),
            ('External and uncertain', 'Payment gateway, maps/routing, FCM push, object storage and Cloudflare live video are integration boundaries. Their readiness depends on service configuration and account status. A source route or asset type is not proof that a provider is healthy or a Cloud Function exists.'),
        ],
        'sources': 'firebase.json; backend/main.py; backend/work_service.py; backend/work_worker.py; docs/REPAIDIANS_WORK_ARCHITECTURE.md',
    },
    {
        'title': '02  Identity, roles and sensitive access',
        'subtitle': 'LLD: a Firebase identity is verified on each protected API; a business profile has its own review and permission state.',
        'nodes': [('Sign-in', 'Firebase ID token on client'), ('API verifier', 'Validate token + current account'),
                  ('Role / owner checks', 'Scope, status, participants, consent'),
                  ('Transaction', 'Expected version + idempotency'),
                  ('Audit response', 'Bounded result; no credential echo')],
        'details': [
            ('Multi-business identities', 'One phone identity may own separate service-work, cab owner, driver and scrap collector registrations. Each business is independently pending, approved, rejected or expired. A client-side desk switch never grants a capability; protected endpoints re-evaluate the server record.'),
            ('Contract and community scope', 'Private proposals are restricted to their customer and proposer; award creates the canonical project and enables private messaging. Public progress defaults off and is separately consented. Repaidians posting and professional capabilities rely on approved records, not a self-selected profile label.'),
            ('Engineer console', 'The separate console accepts a Repaido Firebase ID token with an engineer custom claim and performs a revoked-account check. Its engineering API is read-only, access is audited with a pseudonymous actor hash, and source excerpts redact string literals.'),
            ('Boundary failures', 'Reject missing, expired or wrong-owner tokens before reads of private data. Conditional credentials and secrets stay in Cloud Run/Secret Manager. Response caches and continuation cursors bind account and filter state; changing identity invalidates private cached views.'),
        ],
        'sources': 'docs/business-suites.md; docs/CUSTOM_CONTRACTS.md; engineering/server/app.py; docs/REPAIDIANS_WORK_ARCHITECTURE.md',
    },
    {
        'title': '03  Search: public catalogue to live availability',
        'subtitle': 'LLD: discovery indexes narrow candidates; current operational records decide visibility, distance and eligibility.',
        'nodes': [('Typed query + city', 'POST discovery/search or hiring/search'),
                  ('Snapshot prefix index', 'Bloom prefilter + exact postings'),
                  ('Candidate hydration', 'Approved workers, catalogue, reviews'),
                  ('Live eligibility', 'Location, online, travel radius, stock'),
                  ('Result + booking', 'Displayed card; final command rechecks')],
        'details': [
            ('Repair and service discovery', 'POST /operations/discovery/search combines service text, category and worker matches. Professional ranking considers service match, review confidence and distance. Only approved, online professionals with recently updated location are shown; displayed availability is reconfirmed after a request.'),
            ('Hiring and category reads', 'POST /operations/hiring/search and /recommendations use worker/category/review evidence. Public city-only leaderboards have short server and per-tab caches, while GPS and live availability bypass the public server cache. Failed refreshes can retain visible cards with a retry indication.'),
            ('Index correctness', 'The immutable snapshot uses a versioned Bloom filter only as a negative prefilter, then exact prefix postings. A Bloom positive is never enough to create a hit. Every content change changes the snapshot digest; larger data sets need a dedicated materialized search index and measured load tests.'),
            ('Search limits', 'The current code still has some wide cross-city/online-worker reads. A bounded index improves ordinary city queries but does not establish million-worker scale. Final hire/booking actions must check current status, city, radius, ownership and pricing against authoritative records.'),
        ],
        'sources': 'backend/discovery.py; backend/search_index.py; backend/hire_discovery.py; docs/HIRING_SEARCH.md',
    },
    {
        'title': '04  Behavioural signals and recommendation events',
        'subtitle': 'LLD: consented activity changes ranking and home focus; it does not authorize price or override current supply.',
        'nodes': [('User action', 'Search/view/banner event with event ID'),
                  ('Consent gate', 'Account-scoped preference version'),
                  ('Signal ledger', 'Deduplicate, rate-limit, cap weights'),
                  ('Feed assembly', 'Transport / repair + local cards'),
                  ('Client hydration', 'Refresh or retain cards; clear on sign-out')],
        'details': [
            ('Signal collection', 'POST /operations/discovery/events accepts only consented, typed actions. Source weights are search 1.5, category view 1, service view 2 and banner open 0.5. Event IDs, recent-target and rate limits constrain repeats; per-category signal scores are capped.'),
            ('Contextual feed', 'GET /operations/discovery/feed works without personal data; /feed/personal uses an enabled version-2 preference. The feed can prioritize transport or repair and local categories from recent signals. It is a deterministic presentation choice, not an inferred guarantee of intent, availability or fare.'),
            ('Work discovery', 'The separate work API accepts opt-in behaviour and combines interests with native jobs/contracts. Its documented work-v2 score weights trade .45, skill .25, city .15, experience .10, and optional interest terms .025 each. Results are ranked within a bounded page, not a global probability.'),
            ('Recommendations and rechecks', 'Signal projections are disposable; authoritative service, professional, contract and transport records still control each card and command. Opt-out/reset stops personalization. Stale cards can be displayed briefly during revalidation but cannot create unauthorized bookings.'),
        ],
        'sources': 'backend/discovery.py; backend/repaidians_work.py; docs/work-discovery-api.md; docs/HIRING_SEARCH.md',
    },
    {
        'title': '05  Campaign suggestions and price integrity',
        'subtitle': 'LLD: the funded campaign engine selects offers, then atomically reserves an eligible discount at checkout.',
        'nodes': [('Admin campaign', 'Budget, placement, dates, service'),
                  ('Eligible feed', 'City, margin, consent, limits'),
                  ('Click / selection', 'Tracked event and candidate quote'),
                  ('Order command', 'Recheck offer version + price'),
                  ('Reservation ledger', 'Budget and user use committed')],
        'details': [
            ('Configuration', 'Administrators manage campaigns and controls under /operations/admin/campaigns and /campaign-controls. A campaign must be active, dated, attached to a real service and funded. The server rejects an offer that exceeds its discount ceiling or violates the minimum company margin after worker share, bonus reserve and risk allowance.'),
            ('Personal feed and push', 'POST /operations/campaigns/feed gives general cards; /feed/personal uses campaign/discovery consent. Placement may be home, explore, checkout, launch or push. Delivery rechecks campaign version, customer device audience, push preference, quiet hours and daily limits at send time.'),
            ('Selection and booking', 'The quote and select APIs return an exact advertised price. The job/order transaction rechecks campaign version, city, service, per-user limit and remaining budget before reserving a discount. Reservation is durable; cancellation does not automatically release it, preventing a budget or reuse race.'),
            ('What is not claimed', 'The engine is a deterministic, bounded policy system, not autonomous six-month profit optimization. Personal signals can reorder eligible cards, but cannot change a campaign amount or invent an offer. Real checkout total and subsidy accounting must come from the server snapshot.'),
        ],
        'sources': 'backend/promotions.py; backend/operations.py; backend/discovery.py',
    },
    {
        'title': '06  Repair booking and service work lifecycle',
        'subtitle': 'LLD: discovery creates a request; worker assignment, visits, evidence, payment and review form a versioned lifecycle.',
        'nodes': [('Discovery card', 'Search + quote / availability'),
                  ('Booking command', 'Customer request + retry key'),
                  ('Dispatch', 'Offer worker; timeout and reassignment'),
                  ('Visit', 'Arrival, work log, evidence, follow-up'),
                  ('Completion', 'Payment, receipt, verified review')],
        'details': [
            ('State and retry safety', 'Operations jobs are authoritative. Commands record an idempotency key and payload fingerprint so identical retries return the same result while mismatched replays fail. Assignment and completion follow server state transitions, not a client toast or a cached card.'),
            ('Background obligations', 'The main API operational scheduler runs roughly every 30 seconds. Its sweep expires worker offers, emits preparation reminders, assesses auditable obligations and dispatches waiting jobs. The same sweep calls shared-departure alert processing; it is not an independent Cloud Function.'),
            ('Evidence and protection', 'Arrival can use a server-side code; capture sessions own image uploads. Private job evidence and reports are role-checked. Tracking requires a session and consent, and a completed or stopped session must no longer act as continuous location sharing.'),
            ('Settlement and support', 'Gateway order/check and signed webhook paths verify payment. Job receipt, review, stop/resolution and support routes remain available for post-booking management. A gateway capture is collection evidence; settlement/payout has separate administrator and provider state.'),
        ],
        'sources': 'backend/operations.py; backend/integrations.py; backend/evidence.py; backend/lifecycle.py; backend/procurement.py',
    },
    {
        'title': '07  Hiring, contractor work and private tenders',
        'subtitle': 'LLD: a customer request can match eligible contractors, receive private bids, award work and create a project ledger.',
        'nodes': [('Customer requirement', 'Custom query + private site/terms'),
                  ('Native tender', 'Indexed trade/city/skill facets'),
                  ('Eligible discovery', 'Contractor/work API bounded pages'),
                  ('Private proposal', 'Bid, interest, enquiries'),
                  ('Award + project', 'Terms, team, records, payments')],
        'details': [
            ('Native records and discovery', 'POST /operations/custom-contracts/queries writes a normalized tender. Contractor opportunities and the separate Repaidians work API read native records through indexed projections. Discovery cannot make a private request public or reveal exact site, proposals or payment records.'),
            ('Before and after award', 'Interests are intent receipts, not hires. Proposal text and accepted terms live in bounded private documents. Award atomically creates the canonical contract project; only then can private customer-contractor messaging and the project record lifecycle proceed.'),
            ('Hiring lifecycle', 'Projects can invite or accept workers; applications, decisions and capacity constraints are server-owned. Pending offers reserve capacity and accepted workers count once. The project work state still requires start, pause and completion commands even after hiring closes.'),
            ('Customer visibility', 'The bookings view should emphasize request status, bids, project milestones and actions. Match scoring is explainable candidate evidence, not a guarantee. Public progress is opt-in by the customer, media needs uploader consent, and revocation is checked on reads.'),
        ],
        'sources': 'backend/custom_contracts.py; backend/contract_work.py; backend/contract_records.py; docs/CUSTOM_CONTRACTS.md',
    },
    {
        'title': '08  Repaidians, companies and work updates',
        'subtitle': 'LLD: social publication and professional opportunity discovery share identity but have different audiences and rules.',
        'nodes': [('Native write', 'Post, project, tender, profile, job'),
                  ('Projection index', 'Bounded work/search projection'),
                  ('Work API query', 'Scoped match and visibility check'),
                  ('Application / watch', 'Ownership + state transaction'),
                  ('Durable update', 'Notification and optional push')],
        'details': [
            ('Social surface', 'The main API owns /repaidians/feed, publications, comments, follows, messages, media and notifications. Approved professional records gate professional publishing. Blocks, audience settings and visibility are checked when content is read or acted upon.'),
            ('Work surface', 'The work API serves preferences, interests, jobs, contracts, company pages and placements. Native source records remain authoritative; indexing updates and a bounded backfill feed projections. Work-service admission is capped and may return 503 with Retry-After under overload.'),
            ('Delivery semantics', 'A private worker processes due work updates from durable state. Its dispatch-time checks re-evaluate consent, blocks, ownership and current status. Daily contract-watch updates are limited; FCM transport is at-least-once, so stable IDs support client deduplication after ambiguous provider receipts.'),
            ('Cross-app consistency', 'The customer bookings, contractor desk and Repaidians work panels are views of linked native records rather than three independent posts. A stale projection can delay discovery; it cannot authorize an award or reveal a private tender.'),
        ],
        'sources': 'backend/repaidians.py; backend/repaidians_work.py; backend/work_worker.py; docs/REPAIDIANS_WORK_ARCHITECTURE.md',
    },
    {
        'title': '09  Cab, shared ride and live journey safety',
        'subtitle': 'LLD: owners publish capacity; customers join a matched route; boarding, movement and guest tracking remain state-bound.',
        'nodes': [('Approved fleet', 'Owner / driver + vehicle review'),
                  ('Publish route', 'Departure, stops, seats, per-seat fare'),
                  ('Nearby search', 'Pickup area + route eligibility'),
                  ('Join and board', 'Owner accepts; passenger status'),
                  ('Journey', 'Position, guest link, expiry')],
        'details': [
            ('Supply and matching', 'Cab owners configure vehicle details and prices; partner and vehicle approval is separate. /transport/nearby and /shared/search use bounded local records. A published ride is discoverable only while scheduled and eligible for the searched pickup/route.'),
            ('Shared departure events', 'Joining creates a passenger request and alerts the owner/driver. Commands update acceptance, boarded, travelling, drop-off, finish, cancel or reschedule state. Departure reminders and passenger arrival cues are processed by the main API scheduler and stored as notifications; push delivery depends on device and provider readiness.'),
            ('Precise location boundary', 'Position submission requires current journey state, tracking consent/session and server checks. A guest tracking token is scoped to one active ride, not an account login. It stops working after the journey/consent ends. A map can show recent coordinates but must identify stale location.'),
            ('Payment and fare truth', 'Owner-defined tariffs are snapshotted before customer acceptance. The documented ₹500 advance credits the fare, with a ₹500 minimum total. Payment and route-provider readiness are independent from UI publication; the server policy endpoint reports integration readiness.'),
        ],
        'sources': 'backend/local_business.py; backend/mobility_journeys.py; backend/shared_departure_alerts.py; docs/business-suites.md',
    },
    {
        'title': '10  Marketplace, rentals, B2B and scrap',
        'subtitle': 'LLD: distinct commerce models share authentication and payments, but each has separate inventory, approval and fulfillment.',
        'nodes': [('Browse / quote', 'Market, retail, rentals, B2B, scrap'),
                  ('Source record', 'Listing, stock, RFQ or pickup report'),
                  ('Decision', 'Owner/shop/buyer/customer acceptance'),
                  ('Fulfillment', 'Pickup, delivery, weighing, return'),
                  ('Ledger', 'Payment, receipt, dispute/refund')],
        'details': [
            ('Listings and retail', 'Marketplace listing photos, publish, search, radius, contact and moderation routes are separate from retail checkout. Retail quote/order/payment routes snapshot price and stock. Shop acceptance, customer receipt and reconciliation remain explicit state transitions.'),
            ('Rentals and B2B', 'Rental catalog/inventory, booking code, pickup/return commands, payment and deposit refund form one lifecycle. B2B listings, RFQs, quotations and PDFs form another; quotes are not a public listing purchase.'),
            ('Scrap sale', 'The customer submits a collection. A buyer inspects, records weighing evidence and an itemized net-weight price; the customer approves before collection and confirms actual payment receipt. The buyer-to-customer payment is not gateway verified merely because a UI record says paid.'),
            ('Public cleanup is separate', 'Roadside litter reports require permission, private before/after evidence, assigned collector, fresh proximity and independent admin verification. Repaido-funded cash rewards are manual; points are awarded once from verified cleanups. A report is not an ownership claim or automatic public-property removal permit.'),
        ],
        'sources': 'backend/marketplace.py; backend/retail_checkout.py; backend/rentals.py; backend/b2b.py; backend/cleanup.py; docs/COMMUNITY_CLEANUP.md',
    },
    {
        'title': '11  Captain points, offers and leaderboard privacy',
        'subtitle': 'LLD: cleanup rewards are deterministic server calculations with explicit cash and discount accounting.',
        'nodes': [('Verified cleanup', 'Admin evidence + independent review'),
                  ('Award ledger', '10 points once; capped daily'),
                  ('Rolling qualification', '100 points in last 30 days'),
                  ('Private/opt-in view', 'City rank and selected avatar'),
                  ('Offer reservation', 'Server policy + one use window')],
        'details': [
            ('Points and Gold', 'Only verified cleanup awards count: 10 points each, at most five scored verifications per India-calendar day. Gold requires 100 points earned in the last 30 days. Ranking points remain full for 30 days, then decay linearly over the next 30 days to a 30% floor; lifetime totals remain.'),
            ('Evidence and privacy', 'Scoring checks include permission, safe material, independent reviewer, distinct before/after uploads, disposal record, fresh 300 m site proximity and once-only award. Device GPS is not anti-spoof proof. The optional city leaderboard publishes only opt-in profile details and a separately uploaded portrait, never report photos or exact sites.'),
            ('Offer status', 'Repair visiting fee stays at 30% per product decision. Shared-ride, cab-base and rental benefits are locked pending approved rupee caps and checkout adapters. Refurbished-appliance CAPTAINREFURB25 is 25% up to ₹1,000 on an approved category allowlist, reserved with stock and a price snapshot.'),
            ('Funding and redemption', 'Repaido funds the eligible refurbished discount; the shop payable retains the undiscounted item amount and a community reward expense balances the ledger. Manual cleanup cash handover and customer receipt are a different ledger. No offer is inferred from leaderboard rank alone at checkout.'),
        ],
        'sources': 'backend/captain_rewards.py; backend/cleanup.py; docs/COMMUNITY_CLEANUP.md',
    },
    {
        'title': '12  Payment, external provider and refund boundaries',
        'subtitle': 'LLD: an intent/order is not a capture; a capture is not provider settlement or a contractor payout.',
        'nodes': [('Server quote', 'Paise amount + immutable terms'),
                  ('Gateway order', 'Server-created provider reference'),
                  ('Provider confirmation', 'Signed webhook / retrieval'),
                  ('Internal ledger', 'Idempotent capture and entitlement'),
                  ('Settlement / refund', 'Separate reconciliation + status')],
        'details': [
            ('Trust and integrity', 'Browser and Android clients may initiate payment but cannot declare success. /operations/webhooks/razorpay/{channel} and check routes authenticate provider evidence. Order, capture and refund references must be replay-safe and tied to the exact booking or order.'),
            ('Contracts', 'A partial-payment request reserves integer paise against the agreed total. Customer approval precedes an online gateway order. External NEFT/RTGS reports remain pending until an authorized operator verifies reference, evidence and reason. Gateway collection is not evidence of contractor payout.'),
            ('Other domains', 'Jobs, retail, rentals, market listings, cab bookings, home-plan invoices and professional membership have domain-specific payment routes in the appendix. Shared gateway utilities do not make those lifecycles interchangeable; each record owns its amount and completion state.'),
            ('Sensitive records', 'Bank details, provider secrets, identity documents and raw evidence must be limited to authorized handlers. The engineering console never forwards secret resources, raw request bodies, headers or log payloads. Operational audits should retain event IDs, actor references and amounts without exporting credentials.'),
        ],
        'sources': 'backend/integrations.py; backend/contract_records.py; backend/retail_checkout.py; backend/local_business.py; engineering/server/cloud.py',
    },
    {
        'title': '13  Scheduler, outbox, push and event processing',
        'subtitle': 'LLD: two scheduling models coexist: an in-process operational sweep and a separately invoked private work worker.',
        'nodes': [('State change', 'Transaction + durable event/outbox'),
                  ('Due selector', 'Main sweep or Scheduler worker'),
                  ('Eligibility check', 'Audience, status, consent, expiry'),
                  ('FCM send', 'Provider attempt + stable event ID'),
                  ('Device', 'In-app bell; optional sound/push')],
        'details': [
            ('Operational sweep', 'The main API lifespan starts a ~30-second loop that calls operations_tick. It expires job offers, queues reminders, dispatches waiting jobs and checks shared departures. A distinct authenticated POST /operations/internal/tick invokes broader domain ticks and reconciliation; its invocation cadence must be audited in Cloud Scheduler.'),
            ('Private work dispatch', 'The documented Cloud Scheduler job repaido-work-updates runs each minute in Asia/Kolkata and calls POST /internal/work/dispatch on a non-public Cloud Run worker using OIDC. IAM and application-layer audience/account checks both apply. Work updates, push relay and expired live sessions are processed in bounded batches.'),
            ('Delivery semantics', 'Work push uses leases, per-device receipts, retries and eligibility rechecks. A crash between provider acceptance and receipt commit can repeat a push: stable notification IDs allow device deduplication. Device ownership is rechecked after account migration and lock-screen content stays generic.'),
            ('Monitoring consequence', 'Observe enqueue-to-send lag, due queue depth, retries, permission failures and provider acceptance separately from client display. A notification stored in Firestore does not prove that a sound played or that the OS delivered push; client telemetry is required for that end-to-end claim.'),
        ],
        'sources': 'backend/main.py; backend/operations.py; backend/shared_departure_alerts.py; backend/work_worker.py; docs/REPAIDIANS_WORK_ARCHITECTURE.md',
    },
    {
        'title': '14  Live media and object boundaries',
        'subtitle': 'LLD: API routes control entitlement and metadata; live media streams through Cloudflare, while private uploads stay access-checked.',
        'nodes': [('Publisher', 'Approved Repaidian starts a session'),
                  ('Main API', 'Create, activate, heartbeat, audience'),
                  ('Cloudflare Stream', 'WHIP ingest + WHEP playback'),
                  ('Viewer', 'Short-lived signed play URL'),
                  ('Expiry', 'Lease, duration and admin end')],
        'details': [
            ('Live video', 'The API creates a provider live input only when Cloudflare account, token and signing key are configured. Provider endpoint host/scheme are validated. Broadcast transport is direct to Cloudflare; the Repaido API does not relay video bytes or certify a million-request-per-second media load.'),
            ('Lease and audience', 'Activate and heartbeat keep a bounded session live. Watch returns a short-lived signed playback URL after checking current visibility and entitlement. End, missing heartbeat or maximum duration closes/revokes the session. A due index supports bounded expiration work.'),
            ('Recorded and private media', 'Repaidians posts and the evidence/document services use owned media references. Read routes check publication visibility or authorized participant roles. Private cleanup, contract, identity and job evidence must not be projected into public media or the engineering console.'),
            ('Provider readiness', 'GET /repaidians/live/status reports whether required Cloudflare configuration is present; a source implementation alone does not establish that live streaming is enabled in production. Provider errors should surface as unavailable, not fake playback URLs.'),
        ],
        'sources': 'backend/repaidians_live.py; backend/repaidians.py; backend/evidence.py; docs/CUSTOM_CONTRACTS.md',
    },
    {
        'title': '15  Observability and the engineering console',
        'subtitle': 'HLD: a read-only console combines source-declared links with bounded GCP observations; each view carries provenance.',
        'nodes': [('Source graph', 'Routes, service declarations, call edges'),
                  ('Cloud Asset', 'Selected GCP resources and references'),
                  ('Metrics / logs', '5-minute metrics; recent sanitized events'),
                  ('Cloud Trace', 'Recent sampled spans'),
                  ('Engineer canvas', 'Authorized zoom, detail and live refresh')],
        'details': [
            ('Inventory and evidence', 'The collector reads selected Cloud Asset Inventory types including Run, Firestore, storage, network and Cloud Functions if present. Inventory caches for 300 seconds. A control-plane Ready condition is not an end-to-end service test; inferred source links are labelled separately from observed assets.'),
            ('Metrics and logging', 'Cloud Monitoring data is refreshed on a 60-second cache using a trailing five-minute interval. Cloud Logging reads at most 100 recent Cloud Run/Function entries over 15 minutes, with a 15-second cache. It extracts sanitized metadata, not raw log content, secrets, request bodies or headers.'),
            ('Traces and precision', 'Cloud Trace uses a 15-minute window and a 60-second cache, with a bounded trace/span page. Unsampled or uninstrumented calls are invisible. A missing line or span does not prove that no call happened. Collector states distinguish connected, stale and unavailable.'),
            ('Access and operations', 'Engineer-only Firebase claims protect /engineering-api endpoints; SSE streams are bounded. The console can support triage, but it cannot replace incident alerting, SLO instrumentation, database audit review, full distributed tracing or provider status checks until those are explicitly measured and validated.'),
        ],
        'sources': 'engineering/server/app.py; engineering/server/cloud.py; engineering/server/catalog.py; engineering/README.md',
    },
    {
        'title': '16  Data design, privacy and failure modes',
        'subtitle': 'LLD: transactional native records are authoritative; indexes, caches and feeds are projections with explicit invalidation.',
        'nodes': [('Command', 'Owner + version + retry key'),
                  ('Native record', 'Firestore transaction / SQLite test'),
                  ('Projection', 'Index, feed, rank, outbox'),
                  ('Query cache', 'Bounded TTL + account binding'),
                  ('Revalidation', 'Current state before action')],
        'details': [
            ('Consistency map', 'Jobs, tenders, projects, vehicles, shared departures, shop orders and cleanup reports own lifecycle state. Firestore transactions coordinate related counters, reservations, points and notifications. Search postings, city leaderboards and work projections are rebuilt or advanced from source records.'),
            ('PII and precise position', 'Exact home/site addresses, identity documents, private proposals, bank references, location tracks and report photos require route-level ownership and role checks. Guest ride links carry scoped expiring access only. Opt-in public progress and leaderboard avatars are independent disclosure decisions.'),
            ('Cache and projection misses', 'A short client/server cache can show an older card, but commands re-read authoritative status and price. Background indexing can lag; partial backfill must not be represented as exhaustive results. Retry after 503 uses jitter and keeps visible prior results instead of triggering repeated full-screen loading.'),
            ('Operational scale gates', 'Current per-process caches, bounded pages and autoscaling settings are design controls, not load certification. Large city search, global ranking, push throughput, Cloudflare viewer scale and database cost need representative traffic tests, read/write budgets, error budgets and regional failure exercises.'),
        ],
        'sources': 'backend/operations.py; backend/search_index.py; backend/repaidians_work.py; docs/HIRING_SEARCH.md; docs/COMMUNITY_CLEANUP.md',
    },
    {
        'title': '17  Network ingress and request controls',
        'subtitle': 'HLD: Hosting, Cloud Run and provider egress have separate trust decisions; same-origin transport does not grant data access.',
        'nodes': [('Browser / Android', 'HTTPS + Firebase ID token'),
                  ('Firebase Hosting', 'Static SPA; ordered /api rewrites'),
                  ('Cloud Run ingress', 'Main / work; private worker IAM'),
                  ('Middleware + route', 'Body bounds, CORS, auth, ownership'),
                  ('Provider egress', 'GCP APIs, Razorpay, FCM, Routes, Stream')],
        'details': [
            ('Public path map', 'firebase.json routes exact work paths before /api/** to repaido-api. Each API strips the /api prefix after the Hosting rewrite. The customer shell and business panels are one web deployment; the direct engineering console is a separate Cloud Run origin and authorization surface.'),
            ('Transport controls', 'The main and work APIs configure exact allowed frontend origins and security headers. The work API adds bounded admission, a short queue wait and Retry-After on overload. CORS only controls browser cross-origin transport; Firebase identity, role, owner and consent checks still protect data.'),
            ('Private boundaries', 'The work worker has no Hosting rewrite and requires Cloud Run invoker IAM plus an application-verified Scheduler token. Engineer APIs require the engineer claim and revoked-account check. Backend service identities read Firestore and provider secrets from configured runtime bindings.'),
            ('Infrastructure uncertainty', 'Source declarations show expected edges, not a live VPC, firewall, load balancer, NAT or IAM graph. The engineering collector can read selected Cloud Asset types and explicit references if permission is granted; omitted assets and network flows must be audited independently.'),
        ],
        'sources': 'firebase.json; backend/main.py; backend/work_service.py; backend/work_worker.py; engineering/server/cloud.py',
    },
    {
        'title': '18  Sensitive-process data zones and disclosures',
        'subtitle': 'LLD: identity, money, precise location and private media each require a separate server-side authorization and retention boundary.',
        'nodes': [('Sensitive input', 'Token, document, address, bank, position'),
                  ('Authorized command', 'Owner/role/consent/version checks'),
                  ('Private store', 'Native Firestore + owned object'),
                  ('Scoped projection', 'Summary, status, notification'),
                  ('Authorized read', 'Recheck audience + expiry')],
        'details': [
            ('Identity and documents', 'Business verification documents, account portraits and job/cleanup evidence use distinct upload owners and read endpoints. An approved business status cannot be inferred from an uploaded file; an administrator reviews each business registration and evidence record.'),
            ('Money and contracts', 'Exact payment amounts, gateway capture references, external bank transfer evidence and payout status belong to domain ledgers. Private contract scope, bid text, site, messages and reports stay participant-only. Public progress requires owner and uploader choices and live revocation checks.'),
            ('Location and guest access', 'A device position has freshness, accuracy, state and consent checks before journey or cleanup use. Guest ride tracking is scoped and expires with the journey. Worker attendance and cleanup proximity are evidence of a reported event; neither establishes continuous surveillance or fraud-proof GPS.'),
            ('Logs and operational reads', 'Engineering collection strips log payloads, headers, secrets, environment values and database documents. The console shows summarized route, service, status and trace metadata. Production access reviews must also cover retention, support exports, backups and operator permissions; those cannot be certified from this source snapshot.'),
        ],
        'sources': 'backend/integrations.py; backend/contract_records.py; backend/mobility_journeys.py; backend/cleanup.py; engineering/server/cloud.py',
    },
    {
        'title': '19  Event trigger matrix across apps',
        'subtitle': 'LLD: user commands write native state; indexes, notifications and recommendations consume bounded projections and due work.',
        'nodes': [('Interaction', 'Search, publish, join, pay, verify'),
                  ('API command', 'Typed payload + retry protection'),
                  ('Native commit', 'Owner record, version, event'),
                  ('Async projection', 'Index, feed, queue, badge'),
                  ('Read surface', 'Bookings, bell, work, explore')],
        'details': [
            ('Discovery triggers', 'Search/category/service/banner events update consented interests, which affect personal discovery feed and campaign ranking. Worker, service and catalogue writes change search snapshots or native work projections. A new shared departure enters local transport discovery after publication; final join checks current capacity.'),
            ('Business triggers', 'A custom contract query creates a tender and matching work projection; private bids and award update customer bookings, contractor desk and Repaidians work state. A ride join creates a passenger request and driver alert. Boarding, departure, reschedule and location commands update both business and passenger views.'),
            ('Money and recognition triggers', 'A provider capture updates the domain payment ledger only after verification. A verified cleanup adds one points award and may change Gold/leaderboard ranking; an approved cash reward remains separate until handover and reporter receipt. Campaign clicks do not reserve a discount until eligible checkout.'),
            ('Due work and observable states', 'Main in-process sweep handles operations reminders and shared-departure alerts. Authenticated /operations/internal/tick handles wider reconciliation. Scheduler invokes the private work worker for queued updates, FCM relay and live expiry. Monitoring should correlate the native event ID through projection, queue, send receipt and final UI acknowledgement.'),
        ],
        'sources': 'backend/discovery.py; backend/promotions.py; backend/repaidians_work.py; backend/integrations.py; backend/work_worker.py',
    },
    {
        'title': '20  Release, verification and incident response',
        'subtitle': 'HLD: select the changed service; verify its contract and live revision; keep rollback and observability aligned.',
        'nodes': [('Changed files', 'Select web / api / rules / console'),
                  ('Cloud Build', 'Target-specific tests and image'),
                  ('Candidate', 'Check build ID, storage, routes'),
                  ('Promotion', 'Explicit release gate'),
                  ('Observe / revert', 'Health, errors, latency, policy')],
        'details': [
            ('Selective pipeline', 'The first nine pages document the exact checked-in Cloud Build steps. Web changes use a Hosting-only pipeline, API changes use one immutable image for main/work runtimes, rules changes run emulator tests, and the engineer console has its own build. Mixed changes select the full path.'),
            ('Verification', 'Check the released source/build ID on Hosting and service health endpoints. Run a representative protected request, a private-worker dispatch check when relevant, and Firestore rule tests for access changes. The source tree may be ahead of the publicly observed October 14 snapshot; never confuse a Git commit with a live revision.'),
            ('Incident drill', 'Record the failed build or revision, isolate the affected service and check logs/metrics with exact time bounds. Verify whether a provider, scheduler, projection or client cache failed before replaying jobs. Revert traffic or Hosting/rules with an explicit compatible schema review; background events may still be in flight.'),
            ('Evidence gap register', 'A full live resource audit needs authorized GCP inventory and IAM inspection. This PDF describes code-declared routes and the noted public health checks; it cannot certify every database index, secret binding, Cloud Function, external account, alert policy, trace coverage or deployed customer APK.'),
        ],
        'sources': 'cloudbuild*.yaml; engineering/cloudbuild.yaml; scripts/release-batch.sh; firebase.json; public health snapshot 14 Oct 2026 01:02 UTC',
    },
]


def page_count():
    return 1 + len(TOPICS) + math.ceil(len(ROUTE_ROWS) / ROWS_PER_PAGE)


def scope_page(c, d, number):
    c.bookmarkPage('reading-guide')
    c.addOutlineEntry(f'{number:02d}  Reading guide', 'reading-guide', level=0)
    d.header(c, number, 'How to read this blueprint',
             'HLD shows system boundaries; LLD follows commands, data and event triggers. Evidence levels are kept separate.',
             'Guide / evidence')
    d.card(c, 48, 157, 344, 203, 'Source-derived',
           'Routes, code paths, Cloud Build steps, Hosting rewrites and data controls were inspected in this checkout. '
           'They describe intended behavior at source revision ' + d.COMMIT[:12] + '.', d.BLUE,
           body_size=12)
    d.card(c, 423, 157, 344, 203, 'Publicly observed',
           'The prior public health check at ' + d.OBSERVED_AT + ' reported Hosting and main/work API build '
           'b421e09592a7, and a separate console revision f7446fcaae38. These are a point-in-time snapshot.',
           d.TEAL, body_size=12)
    d.card(c, 798, 157, 344, 203, 'Needs authorized audit',
           'The PDF does not claim a complete current GCP inventory, configured secrets, all IAM grants, provider '
           'readiness, real-time end-to-end tracing, scale certification or deployed Android binary parity.',
           d.GOLD, body_size=12)
    d.rect(c, 48, 389, 1094, 340, d.WHITE, d.LINE, radius=18)
    d.text(c, 'DOCUMENT MAP', 72, 413, 12, d.BLUE, True)
    d.para(c, '<b>Pages 1–9:</b> manual deployment selection, target pipelines, traffic switch, security controls and the '
           'observed release snapshot.<br/><br/><b>Pages 10–30:</b> runtime topology, auth, discovery, events, '
           'campaigns, bookings, contracts, community, transport, commerce, rewards, payment, push, media, '
           'observability, data and release operations.<br/><br/><b>Remaining pages:</b> the complete code-derived '
           'HTTP method + path catalog, grouped by runtime and source module. Prefix each listed path with '
           '<b>/api</b> through Firebase Hosting, except the direct engineering console and the private worker. '
           'Catalog entries do not imply anonymous access; role checks vary by endpoint.',
           73, 446, 680, 13, d.INK, leading=20)
    counts = collections.Counter(row['service'] for row in ROUTE_ROWS)
    d.text(c, 'CATALOG SNAPSHOT', 814, 416, 12, d.BLUE, True)
    for index, name in enumerate(('main', 'work', 'worker', 'console')):
        d.pill(c, f'{name.upper()}  {counts[name]}', 813, 455 + 55 * index, 265,
               (d.PALE_BLUE, d.PALE_TEAL, d.PALE_GOLD, d.PALE_RED)[index])
    d.para(c, 'Count = method/path declarations after excluding OpenAPI/docs, HEAD and OPTIONS. '
           'The work router is also mounted by the main runtime; repeated paths are shown once per runtime.',
           813, 679, 280, 8.5, d.MUTED)
    c.showPage()


def topic_page(c, d, number, topic):
    key = f'platform-{number}'
    c.bookmarkPage(key)
    c.addOutlineEntry(f'{number:02d}  {topic["title"][4:]}', key, level=0)
    d.header(c, number, topic['title'], topic['subtitle'], 'Platform / HLD + LLD')
    d.text(c, 'REQUEST / EVENT FLOW', 49, 150, 10, d.BLUE, True)
    nodes = topic['nodes']
    width, gap, start = 201, 21, 48
    for index, (label, body) in enumerate(nodes):
        x = start + index * (width + gap)
        d.card(c, x, 181, width, 131, html.escape(label), html.escape(body),
               (d.BLUE, d.TEAL, d.NAVY, d.GOLD, d.BLUE)[index],
               title_size=12.3, body_size=10.2)
        if index < len(nodes) - 1:
            d.arrow(c, x + width + 3, 246, x + width + gap - 3, 246, d.BLUE, 1.7)
    d.text(c, 'DESIGN DETAILS AND OPERATIONAL CONSEQUENCES', 49, 337, 10, d.BLUE, True)
    for index, (title, body) in enumerate(topic['details']):
        x = 48 + (index % 2) * 558
        y = 365 + (index // 2) * 187
        d.card(c, x, y, 536, 170, html.escape(title), html.escape(body),
               (d.BLUE, d.TEAL, d.GOLD, d.NAVY)[index],
               title_size=13.5, body_size=12)
    d.para(c, '<b>Source:</b> ' + html.escape(topic['sources']), 50, 755, 1080, 9, d.MUTED)
    c.showPage()


def catalog_page(c, d, number, offset):
    key = f'catalog-{number}'
    c.bookmarkPage(key)
    c.addOutlineEntry(f'{number:02d}  API catalog {offset + 1}–{min(offset + ROWS_PER_PAGE, len(ROUTE_ROWS))}', key, level=0)
    page_rows = ROUTE_ROWS[offset:offset + ROWS_PER_PAGE]
    end = offset + len(page_rows)
    d.header(c, number, f'API catalog  /  {offset + 1:03d}–{end:03d} of {len(ROUTE_ROWS)}',
             'Code-derived HTTP method + path declarations. Same path under two runtimes is intentional; auth and data access are enforced by the handler.',
             'LLD / route reference')
    d.rect(c, 48, 148, 1094, 33, d.NAVY, radius=5)
    d.text(c, 'RUNTIME', 61, 156, 9.5, d.WHITE, True)
    d.text(c, 'METHOD', 155, 156, 9.5, d.WHITE, True)
    d.text(c, 'API PATH', 250, 156, 9.5, d.WHITE, True)
    d.text(c, 'SOURCE MODULE', 942, 156, 9.5, d.WHITE, True)
    row_h = 18.8
    for index, row in enumerate(page_rows):
        y = 185 + index * row_h
        if index % 2 == 0:
            d.rect(c, 48, y - 1, 1094, row_h, d.PALE_BLUE, radius=2)
        d.text(c, row['service'].upper(), 61, y, 9.3, d.BLUE, True)
        d.text(c, row['method'], 155, y, 9.3, d.INK, True)
        path = row['path']
        if len(path) > 110:
            path = path[:107] + '...'
        d.text(c, path, 250, y, 9.3, d.INK)
        module = row['module']
        if len(module) > 28:
            module = module[-28:]
        d.text(c, module, 942, y, 9.3, d.MUTED)
    d.para(c, 'Route inventory generated from FastAPI registrations in isolated SQLite mode. It is not an authorization audit '
           'or a guarantee that a route exists on the currently deployed revision.', 49, 765, 1080, 8.1, d.MUTED)
    c.showPage()


def render(c, d):
    number = 10
    scope_page(c, d, number)
    number += 1
    for topic in TOPICS:
        topic_page(c, d, number, topic)
        number += 1
    for offset in range(0, len(ROUTE_ROWS), ROWS_PER_PAGE):
        catalog_page(c, d, number, offset)
        number += 1
    assert number - 1 == d.TOTAL_PAGES
