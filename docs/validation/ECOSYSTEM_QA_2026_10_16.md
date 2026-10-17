# Repaido ecosystem QA — 16 October 2026

This report covers the local working tree based on `a9c27885b8874917b36bdc0f251b71e744e2c19d`, including the uncommitted QA fixes. It is not a production release certificate. No deployment, push, production data change, real charge, refund, payout, email or push notification was performed.

The audit covers the customer website, partner workflows, company administration, marketplace and shops, Repaidians, payment/reward calculations, API authorization, engineering console, deployment packaging, Firestore rules and Android packaging configuration. Browser coverage uses Chromium with disposable local APIs or explicit fixture providers. It does not substitute for real customer accounts and live provider testing.

## Final verification

Final run counts and the browser manifest are recorded in the accompanying `ECOSYSTEM_QA_2026_10_16.json`. Focused runs below overlap the full suite and must not be added together as unique tests.

| Layer | Verification | Evidence |
| --- | --- | --- |
| Backend | 1,473 passed, no failures; 25 emulator-only skips executed successfully in the separate run | `backend-final.log`, `backend-final.xml` |
| Web | All 328 unit tests passed; no failures or skips | `final-web-tests.log` |
| Browser | All 53 current suites have conclusive session passes; affected cases rerun after fixes | `ui-final-manifest.json`, `ui.md` |
| Booking concurrency | 51 checks passed against actual SDK/emulator and transaction doubles, including all 25 emulator-only cases | `legacy-booking-final-emulator.log` |
| Firestore client authorization | 96 assertions passed against the real local emulator; no production data | `infra.md`, `security.md` |
| Engineering | 30 Python tests, 7 frontend tests, desktop/mobile browser smoke and production build passed | `infra.md`, engineering test/build logs |
| Containers | Shared backend image for main/work/worker plus engineering image built; 16 health/authentication/routing probes passed, running as UID 1000 with networking disabled | `final-builds.md`, `final-*-container-smoke.json` |
| cPanel output | TypeScript/Vite build passed; 100 public artifacts inspected, HTML references resolved and both API origins included | `final-web-cpanel-build.log`, `final-web-cpanel-artifacts.json` |
| Infrastructure | Terraform validate and 5 mock-provider tests passed; all 3 selective-build configurations current | `infra.md`, `final-generated-pipelines.log` |
| Dependencies | Both pnpm audits reported zero advisories after targeted fixes; Python installed-dependency compatibility passed | `*-pnpm-audit.json`, `python-dependency-check.log` |
| Android | All 3 release modules no longer use the debug signer; static regression and actual Gradle configuration check passed | `android/README.md`, infrastructure report |

Raw logs, JSON responses and screenshots are retained locally under `/workspace/qa-20261016/`; the summary and machine-readable manifest are retained in this repository. Earlier failing logs are preserved as reproduction evidence and are not substituted for final results. The 53 browser passes were collected throughout the session, with targeted reruns after relevant fixes; they were not all rerun against one identical final snapshot. The older `browser.mjs` prototype harness is outside the current `*.browser.mjs` suite inventory.

## Confirmed defects corrected

### Payments, refunds and accounting

- A late capture response could reopen a refunded retail order and recreate a shop liability. Verification now rechecks financial state transactionally and preserves refund holds.
- A late provider order-create/recovery response could downgrade an already-paid order. Provider attachment now validates identity and preserves terminal state.
- Gateway order/payment responses now require the exact saved order, payment ID, integer amount, currency, receipt and applicable ownership metadata. A checkout signature alone is insufficient proof of captured payment.
- Retail checkout and authenticated webhooks share reconciliation logic. This covers payment after a browser closes, callback-before-order-attachment races, duplicate callbacks and externally observed refunds.
- Observed external refund totals cannot move backwards when an older provider response arrives. Allocations remain held for review until reconciled; the system does not invent refund journals.
- Integer coupon apportionment now assigns rounding remainders without making a small line's discount exceed its price or creating negative seller payables.
- Legacy booking and spare confirmation now commit payment state and fulfillment together. Replays return the original fulfillment; missing, mismatched or refunded fulfillment requires reconciliation.
- The customer booking checkout now passes the server-issued `razorpay_order_id` to the gateway. Cancellation and failed gateway loading never call verification.
- Obsolete specialist-payment endpoints, whose historical records cannot safely establish customer ownership, return an explicit onboarding/reconciliation response without making provider calls.

The finance suites cover server pricing, stock reservations, balanced liabilities, coupon scope/stacking, account-bound rewards, verified scrap/cleanup awards, subscription calendar boundaries, payout holds and idempotency. Marketplace ₹99/month and shop ₹499/month retain their respective 90-day trial policies. Repaidians retains its separate existing ₹199 plan and trial policy; this QA did not silently merge the products' billing rules.

### Booking and work lifecycles

- Firestore booking creation no longer depends on local SQLite or swallows failed synchronization. Create, paid confirmation, cancellation and rescheduling share transactional capacity guards.
- Concurrent mixed booking operations retain the three-booking slot limit. Request markers bind duplicate requests to their customer and payload. Exhausted transaction contention returns a retryable 409 instead of an unhandled 500.
- Home Plan pause/resume can no longer activate an unaccepted plan. Both parties' acceptance and worker eligibility are rechecked.
- Schedule-change approval rechecks future time and the entire visit interval, including date boundaries and approved working hours.
- Contract discovery notifications now advance through bounded source pages. Later matching contracts and watches no longer remain permanently behind an unchanged first page.
- Eligible scrap collectors can open the same requested-job details they can discover. The projection remains sanitized; private customer contact, exact location, payment details and evidence stay restricted. Eligibility disappears when another collector accepts.

### Marketplace and notifications

- A listing cannot close while a partly confirmed handover claim is pending.
- An already agreed handover can complete when the listing expires naturally; closed/suspended records and competing claims remain rejected.
- Repeated out-of-stock/restock cycles now produce distinct idempotent alert transitions instead of losing later alerts to a reused deduplication key.
- Malformed successful professional-profile responses are rejected rather than poisoning the session cache.

### Security and packaging

- Local SQLite logout hashes the same normalized bearer token accepted by authentication. Whitespace-padded logout now invalidates the original session.
- Firebase-only and malformed local password records return the ordinary unauthorized response instead of crashing password login.
- Camera EXIF JSON must be an object. Scalar/array/null metadata returns validation failure without creating evidence.
- Malformed administrator keys and webhook signatures/nested payloads no longer cause server errors. Exact role/claim checks remain required.
- Firebase Hosting's web-level configuration now routes work, company and placement APIs consistently with the root deployment configuration.
- The backend Dockerfile includes the new booking module and supports an optional build-only proxy CA while preserving TLS verification. The engineering build copies the workspace dependency overrides before its frozen install.
- Targeted transitive dependency overrides resolve the reported gRPC and source-map advisories. Both lockfiles passed frozen installation, builds and refreshed pnpm audits.
- Android release variants no longer silently fall back to a debug signing identity. An approved production signer is still required before publication.

### UI, accessibility and test coverage

- Corrected dark-theme surfaces and text in spare discovery, market workspaces, chat handovers, Repaido Home and empty states.
- Corrected tracking labels and status text that failed ordinary or enhanced contrast checks.
- Final visual inspection found tracking controls overlapping at 320px with 200% text despite a passing contrast check. The header now wraps, 44px map controls sit in a separate toolbar, the whole dialog remains scrollable, and the milestone rail supports keyboard scrolling with whole labels. Added geometry checks verify text, controls and map attribution remain separate.
- Corrected narrow-screen community header overlap, contract-header overflow and navigation labels breaking inside words at 200% text size. Navigation retains touch targets and scrolls where necessary.
- Changed the standard web test command to discover every `*.test.mjs` file. Previously 22 existing test files were omitted.
- Replaced stale fixture/selector assumptions with the current user flows while preserving ownership, payload, accessibility and failure assertions. The Docker inventory test now understands continued instructions rather than trying to parse a partial shell command as a file list.
- The protected-media browser test now independently exercises both feed revocation and the media authorization deadline by delaying a real validation response. It checks that expired bytes disappear during reauthorization, remain hidden after denial, and the revoked publication is subsequently removed.

## Cache and performance evidence

The real local Repaidians fixture contained 12 posts, a story and two videos. Its compact metadata response was 1,981 bytes versus 9,492 bytes for full state. Duplicate protected images shared one cold download; off-screen videos downloaded no bytes. Three warm Home/Works round trips fetched no repeated feed or media data. Reopening a story reused its authorized media.

During 31 visible idle seconds, bounded metadata/usage and feed-validation requests continued, but the feed and media did not reload. Account changes rejected delayed responses from the previous identity. Failed shared media requests remained retryable; aborting one observer did not cancel its peer. Revoked media returned 404 before conditional caching could disclose content.

These measurements demonstrate cache behavior in local fixtures. They do not establish a production 1–2 second latency target, concurrent-user capacity or regional mobile-network performance. The production build still reports a 2.82 MB main JavaScript chunk (approximately 769 kB gzip), and the existing lottie-web eval advisory. Those remain optimization/review items; no latency guarantee is claimed.

## API and authorization coverage

The inventory found 718 method/path declarations across main, work, worker, community and ranking applications. Mounted overlap means this is not 718 independent end-to-end tests. No duplicate declarations, static-route shadowing or OpenAPI generation errors were found in the inventory check.

All 631 main-API method/path combinations were probed anonymously against a temporary local database with empty mutation payloads and nonexistent record IDs. Outcomes: 32 public successes, 433 unauthorized, 99 forbidden, 37 validation failures, 28 not-found and 2 expected configuration-related 503 responses. The latter were the unconfigured scheduler and membership webhook. There were no unhandled 500 responses in this probe. This is boundary coverage, not proof of successful authenticated behavior on every route.

Separate suites exercised exact admin/engineer claims, revoked-token SDK contracts, cross-account records, public profile sanitization, private evidence, support attachments, conditional media responses, payload limits, queue limits and CORS. The Firestore rules emulator covered direct client access separately from Admin SDK server transactions.

## Production observations and remaining release gates

Public read-only checks found `repaido.com` serving frontend revision `0bc8da6a22869d30a6cabd91782d3ac15d04570c`, Firebase Hosting serving `b421e09592a7af292e6020ab54f1e6446b83f0b3`, and the main/work health endpoints serving build `a80e74c4-fafc-4cd3-963f-2c68220abe98`. Independently released components may legitimately have different identities. None of these observations establishes deployment of the current QA working tree.

1. **Captured legacy booking without capacity:** gateway capture precedes final slot allocation. A full, expired or conflicted slot can produce 409 after capture. The local payment remains unfulfilled and requires provider/support reconciliation or refund. This QA prevents overbooking and duplicate fulfillment; it does not add an automatic refund/reconciliation worker for that legacy flow. Permanent capacity/time failures must not prompt a new charge. An external refund can also occur after the provider GET; a local database transaction cannot lock provider state, and these checks do not prove live gateway/webhook convergence.
2. **Live identity and provider workflows:** real Firebase sign-in/OTP, Razorpay capture/refund/payout, external webhook delivery, push/email and public streaming were not exercised. The tests use local identities and deterministic provider boundaries.
3. **GCP production access:** configured credentials were present, but the authenticated Cloud Build read returned 401. Live revision provenance, IAM, bucket permissions and index readiness remain unverified. No repeated deployment was attempted.
4. **Android:** compilation/lint/device tests remain blocked by unavailable Android SDK components; official downloads returned 503. The signing checks are not APK runtime validation. Existing public APK downloads were not rebuilt.
5. **Python vulnerability advisories:** installed-dependency compatibility passed, but advisory tools/data could not be obtained (package availability and OSV 503). This is an unavailable scan, not a clean vulnerability result.
6. **Source upload inventory:** generated configurations, import closure and offline `.gcloudignore` modeling passed. The actual `gcloud meta list-files-for-upload` check could not run because gcloud is absent.
7. **Release provenance:** commit and review these fixes before creating a new release artifact. The older staged artifact was marked superseded to prevent publication without the QA fixes. Current local build output is not a signed-off release archive.

## Reproduction

Use the existing checkout and installed dependencies. No worktree or production configuration is required for local tests.

```sh
cd backend
.venv/bin/python -m pytest -q
cd ../web
pnpm test
pnpm build:cpanel
cd ..
backend/.venv/bin/python -m pytest -q engineering/tests
pnpm --dir engineering/web test
pnpm --dir engineering/web build
python3 scripts/generate-selective-builds.py --check
python3 -m unittest discover -s android/tests -v
```

For the 25 booking emulator cases, start a loopback demo Firestore emulator and supply `FIRESTORE_EMULATOR_HOST`; the tests reject remote endpoints. The separate client-rules suite uses `firebase.security-tests.json` and `scripts/test-firestore-security.mjs`. Browser commands, ports and final artifact locations are in the browser manifest and raw reports. Preserve the managed proxy and CA trust for dependency or container builds. Never use production credentials in local fixtures.

Reusable environment setup was saved as a reviewable draft using the cloud environment setup skill: the existing installation instructions gained noninteractive `CI=true` frozen pnpm installation, and the startup notes gained the tested SQLite/browser QA workflow and current validation limits. Existing release instructions and credential bindings were preserved. Saving the draft did not publish the environment or change production. Temporary QA servers and containers were stopped after verification.
