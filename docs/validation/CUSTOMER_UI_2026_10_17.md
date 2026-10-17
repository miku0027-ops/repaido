# Customer support, hiring, mobility and catalogue refinement

Status: implemented and locally verified; not deployed.
Branch: `development/2026-10-17-customer-ui`, based on `421dec121cac5e498ed2dd17b70a2bd85dec0787`.

## Changes

- Support: fixed navigation overflow clipping the floating launcher; added a branded vector mark, refined conversation surfaces, topic shortcuts and a visible reply composer. Large text keeps the Help label clear of Bookings.
- Hiring: category scope photo slides with pause/manual controls, compact professional decisions and approved service/Home shortcuts. The recent-category photo rail uses existing consented recommendation results.
- Mobility: pickup map above a compact planning panel; public scheduled shared meeting points; real nearby availability cards with offline, failed-refresh and empty states. Added keyboard map controls with JavaScript animation disabled.
- Public cab availability: approved drivers can explicitly share a coarse area while parked, with two consent checks, session controls and visible freshness. Customers see anonymous area counts from a separate uncached availability endpoint. Sharing stops on hidden/offline/account changes; stale positions expire after 75 seconds and sessions after 30 minutes. Assignment and booking guards prevent busy or reassigned cabs appearing available.
- Ride forms: connected pickup/drop controls, route swapping, correctly initialized destination editing, date shortcuts, bounded seat controls and compact fare/map review.
- Travel cards: relevant vector motion, explicit pause and automatic suspension when offscreen, hidden or reduced motion is selected.
- Bottom navigation follow-up: layered upward shadow, fine highlighted edge, raised selected surface and position marker, hover/press feedback and matching Gold support launcher. Pinned position, safe-area padding and visible overflow are preserved.
- Catalogue follow-up: replaced the Services category carousel with compact category/sort dropdowns, applied-filter chips and a filter-count badge. The filter sheet uses local drafts, a matching-service preview, reset and explicit apply; Escape discards edits. Distance and professional role controls clearly describe their scope.
- Category leaders: added an optional `summary_only` public leaderboard response with identical eligibility and review-confidence ranking. The overview skips unused rich profiles, offers and recommendations. Warm snapshots render in the first commit; request order prevents older profile responses replacing newer ranks. A narrow unsupported-field fallback supports an older API during rollout.

Existing payment, assignment, ticket authorization and booking-command contracts are preserved. The public leaderboard's new flag is optional; clients requesting the existing full response remain compatible.

## Verification

- Production web build (`pnpm run build`): passed after final edits. Existing bundle-size, mixed-import and third-party Lottie warnings remain.
- Latest web unit suite (`pnpm test`): 338 passed, zero failures/skips.
- Hiring discovery browser suite: passed responsive/light/dark/200% text and accessibility checks; slideshow controls, actual service handoff, recommendation/account isolation and stale-response guards.
- Support evidence browser suite: passed real evidence/retry/privacy checks plus launcher hit testing, visible composer and keyboard focus restoration at 320/390/480px and enlarged text.
- Customer management integration: passed real isolated-API ticket creation, uncertain-submit deduplication, company reply, notifications, escalation and resolution; customer/admin accessibility and responsive checks.
- Existing journeys integration: passed publication, search, explicit fare consent, versioned join, accepted private tracking and notifications.
- New mobility forms browser suite: passed shared search/review and cab date/route controls across 320/390/480/1440px, both themes and 100/200% text; seat bounds, direction swapping and destination editing.
- Expanded marketplace browser suite: passed all five destination layouts, keyboard navigation and booking entries; public map origins, keyboard map controls, offline/error/empty recovery, enlarged-text unknown-location state and absence of private tracking reads. Zero page errors.
- Travel card visual/behavior check: passed 320/390/480/1280px, light/dark accessibility, original booking callbacks, minimum touch targets, pause/play and offscreen/reduced-motion suspension.
- OpenStreetMap tile request through the configured proxy: HTTP 200, valid PNG. Offline browser fixtures intentionally block external tiles and verify the fallback.
- `git diff --check`: passed.
- Bottom navigation follow-up: 24 combinations across 320/390/480/600px, light/dark/Gold and 100/200% text passed geometry, hit testing and WCAG AA checks. OS/app reduced motion, keyboard focus and support dialog focus restoration passed. Evidence: `/tmp/repaido-nav-refinement`.
- Catalogue browser suite: passed category/sort synchronization, draft apply/cancel/reset, query-aware counts, budget and removable filters, city changes, keyboard focus restoration and failure/retry behavior. Compact controls and filter sheet pass 320/390/480px, 100/200% text, selected-value visibility and light/dark AAA checks.
- Leader latency browser regression: verified summary-only requests, leaders loading independently of a delayed catalogue, request coalescing, real cards in the first warm commit, city isolation and approved Home category associations.
- Related backend suite: 64 passed, zero skips across `test_hire_discovery.py`, `test_hire_recommendations.py`, `test_hire_profile_recommendations.py`, `test_hire_search_scale.py` and `test_hire_leader_summary.py`. One existing Starlette deprecation warning.
- Leader cache tests: 9 passed, including legacy API fallback, request-order races, expiry and city/GPS/radius isolation. Independent review confirmed summary/full ranking and privacy equivalence.
- Complete backend regression after the container packaging fix: 1,505 passed, 25 skipped (Firestore emulator variants require `FIRESTORE_EMULATOR_HOST`), zero failures. The new availability module is included in the container image.
- Public cab backend: 28 dedicated tests and independent real HTTP checks cover consent, authorization, token rotation, late Stop, assignment/booking races, stale capture/session expiry and bounded geographic-reference storage. All 33,396 latitude bands were checked; maximum cell displacement is 423.79 m, within the declared 450 m approximation.
- Driver sharing browser suite: explicit consent, no early GPS, account isolation, delayed callbacks/Start responses, offline/hidden stops, uncertain revoke retries, lost Start receipt recovery, remote-session Stop, server-relative freshness and 30-minute expiry passed. Sixteen responsive/theme/text-size variants passed accessibility checks.
- Customer public map integration: actual isolated SQLite HTTP consent, position publication and revocation produce anonymous aggregated counts. Refresh preserves map pan; offline, hidden, failed, malformed and obsolete responses remove markers. Exact monotonic expiry includes network transit time. Twelve responsive/theme/text-size variants passed accessibility, control hit testing and map-status nonoverlap, including 320px at 200% text.

The isolated 46-professional/90-job fixture's cold overview response decreased from 170,018 to 1,921 bytes (98.9%). Local SQLite timings were 55.22 ms for the rich response and 18.06 ms for the summary. These measurements are fixture evidence, not production latency; all verified review evidence remains included in ranking.

Browser evidence is in ignored `web/test-results/`, `/tmp/repaido-support-evidence-browser`, `/tmp/repaido-management-Bqbefx`, `/tmp/repaido-journeys-ZETMlt` and `/tmp/repaido-mobility-forms-jCbMaA`.

## Public location boundary

The catalogue nearby API continues to exclude cab coordinates. The separate operator opt-in contract exposes only anonymous counts in 600 m geographic cells, not vehicle identities or exact GPS. It retains one current geographic reference per vehicle, without a location history. Public map reads run only on a visible, online cab browse screen with a confirmed pickup. Driver sharing is optional, requires fresh foreground GPS, and expires automatically. Private journey tracking and its consent remain separate.

## Release state

This batch is prepared for a matching API and cPanel release to `repaido.com`. The managed environment reports its GCP credential binding as ready, but an actual read-only Cloud Build request returns HTTP 401 `UNAUTHENTICATED / ACCESS_TOKEN_TYPE_UNSUPPORTED`. The existing GCP deployment credential must be repaired securely in environment settings before API submission and website publication. cPanel publication must wait for the matching successful API release. No production release is claimed by the local test results above.

No live website files or production API revisions were modified by this work.
