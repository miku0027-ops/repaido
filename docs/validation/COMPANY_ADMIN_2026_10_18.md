# Company admin: compact workspaces and workflow audit

Development change based on production source `f1ef43876da329647283fcbb704aaca6944e0693`. This report describes local verification, not deployment or a live-provider certification.

## Interface

Company administration has a grouped navigation, operational dashboard and shared searchable, sortable, paginated tables. Row details mount on explicit review; evidence, approval and reconciliation actions retain their original server endpoints and validation. Records use 10/25/50-row pages and numeric sorting for amounts. Tables describe **loaded** records, rather than claiming a whole-business financial total. Mobile tables scroll within a labelled keyboard region; the review control stays visible. Inputs and actions retain 44px targets, focus indicators, dark mode and reduced motion support.

Tables cover service bookings, onboarding, shop applications, business/vehicle applications, Home plans, contractor applications, community listings, network reports, collections, settlements, payouts, refunds, equipment rentals, properties, pickup assessments, campaigns and audit history. Support retains its purpose-built inbox and conversation structure. Campaign controls and editors, hiring configuration and financial authorizations use deliberate disclosure instead of filling every initial screen with forms.

The overview independently loads professional and service-visit snapshots. It shows the current visit-state distribution and direct work queues; it does not invent revenue, conversion, demand or unresolved-support counts. Source failures remain explicit, retries are independent, and account changes invalidate private snapshots.

## Feature decisions and current business contracts

| Workspace | Current authority / workflow | Decision |
| --- | --- | --- |
| Overview / Bookings | `operations.py`: server-owned jobs, recovery, audited location access; `evidence.py` private evidence | Keep; table and real workload summary. Preserve confirmation, version and evidence gates. |
| Workers | Onboarding overview, `/admin/workers/{id}/review`, independent document checks | Keep; status/search/table. Restore reachable private identity/bank follow-up, previously imported but unreachable in active admin. Provider validation remains separate from joining approval. |
| Shops | `shops.py`, `shop_payouts.py`: applications, independent verification, provider bank verification | Keep. Approval is distinct from 90-day/₹499 visibility and optional Prime placement. |
| Transport & scrap | `local_business.py` partner/vehicle review, reconciliation, cleanup evidence and contribution awards | Keep; table applications. Preserve document expiry, verified collection/payout evidence and independent rewards review. |
| Home plans | `home_plans.py`: qualifications, recipient consent, two-party quotes, calendars, attendance and issues | Keep; request table and full selected-plan management. No medical care or automatic renewal. |
| Community | `marketplace.py`, `market_messaging.py`, missions | Keep listings, message reports and missions. Preserve private conversations, 90-day/₹99 marketplace policy and independently verified awards. |
| Finance | `integrations.py`, `refunds.py`: verified collections, settlement holds, payouts, reconciliation | Keep all controls. Separate read tables from explicit money actions. Approval does not mean money was sent; uncertain refunds never submit again through reconciliation. |
| Support | `lifecycle.py`, `support_evidence.py`, retail resolutions | Keep inbox, claims, replies, private evidence, targets, escalation, reopening and returns. These are complementary workflows. |
| Moderation | Network reports, `rewards.py`, evidence and review reports | Keep. Metric corrections require evidence; reviews are not rewritten. |
| Procurement | `procurement.py`, shop payouts | Keep assessment review, custody and actual shop liabilities. No automatic bank debit for assessed penalties. |
| Rentals | `rentals.py`, `housing.py` | Keep both distinct models: equipment custody/usage/deposit settlement and moderated house listings/viewings. Housing does not collect rent/deposits or execute leases. |
| Partner programme | Versioned contractor agreements, criteria and earned listing entitlements | Keep; table applications, preserve thresholds for already-accepted agreements. |
| Rankings | Verified work/review confidence and local leaderboards | Keep. No fabricated scores, sales or scarcity. |
| Service terms | Versioned customer-facing service scope | Keep; do not rewrite existing booking agreements. |
| Global Control | `promotions.py`, campaign outcomes and studio | Keep campaign budgets, protected margins, consent-based targeting and delivery limits. Reserved discounts are not revenue or causal marketing lift. |
| Activity | `workspace.py` audit history | Keep; latest 100 events, searchable/sortable. Not a complete financial ledger. |

Removed `CompanyAdminPortal.tsx` and its unused import after reference inspection confirmed that `/company` uses `OperationsAdmin` through `PortalAccess`. The removed component was a disconnected demo implementation with local session/seeded records. No active operational destination or backend API was removed. Account-owned business/apartment budgeting remains in its existing customer workspace; it was not promoted into a company-wide private-data viewer.

## Architecture conclusions

The deployed system shares a backend image across main, work and private worker applications. Existing transactions, operator claims, worker/customer ownership, immutable policies and payment/provider reconciliation remain authoritative. A visual redesign does not justify adding a separate container per table or duplicating financial state in client storage. These changes add no new production service, scheduler, database collection or Firestore index.

The separate new hourly-hiring request adds pricing, timed-work and schedule changes, documented in [the hourly-hiring validation report](HOURLY_HIRING_2026_10_18.md). The old fixed-day policy is not made hourly by this admin redesign. Existing contract snapshots remain intact.

## Local evidence

- Backend suite: **1,505 passed**, 25 emulator-only skips, 18 deprecation warnings. No production providers or database used.
- Web unit suite: **338 passed**.
- TypeScript/Vite production build passed; existing large-chunk and lottie advisories remain.
- Material icon provenance check passed: 291 exports / 248 symbols / 251 pinned assets.
- Company browser: all 17 destinations, independent API failures/retries, warm cache, stale-response navigation, account switching, real non-admin 403, no mutation from reads/navigation. Overview tested at 320/465/800/1440px, light/dark, 100/200% text; reviewed queues and navigation tested for enhanced contrast.
- Shared-table browser: real rendering of 31 synthetic rows; search, numeric ordering, page sizing, shrinking-source page clamp, explicit detail mount, keyboard region and 16 responsive/enhanced-contrast combinations.
- Company action browser: missing evidence blocks approval; a reasoned rejection persists to the real disposable API and audit; approved/rejected records remain reachable; private verification and bank review can open without a provider mutation.
- Customer-management browser: real support claim/reply/escalation/resolution; support CRM and customer views pass responsive/dark/200%-text/enhanced-contrast variants. Contributions, rental category filters and earned coupons remain connected.
- Homes browser: private-photo decode/retry gates property approval; listing/viewing, retry keys, account separation and customer layout regressions pass.
- Support-evidence browser: attachments/retries, target lifecycle, account isolation, focus and responsive interfaces pass.
- Ecosystem-lifecycles browser: actual marketplace negotiation and two-party handover; independently reviewed community evidence creates exactly one 10-point award, with outsider denial and no premature points.

Raw evidence is retained in `/tmp/admin-*.log`, `/tmp/repaido-admin-*`, `/tmp/repaido-management-*`, `/tmp/repaido-homes-browser`, `/tmp/repaido-support-evidence-browser` and `/tmp/repaido-ecosystem-lifecycles-*` for this session. Fixtures contain synthetic identities only. Local tests do not prove live gateway, OTP, push delivery, production latency, Android runtime or production Firestore concurrency; the 25 skipped emulator tests are not claimed as passes.
