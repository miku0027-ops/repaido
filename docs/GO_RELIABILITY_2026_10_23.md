# Repaido Go presence and reliability audit — 23 October 2026

Status: development changes, not deployed. Production account assignments,
reviews, funding, service activation and cloud capacity were not changed.

## Why the screenshot cannot go online

There is no laptop/mobile user-agent restriction. “Bike needed” means the
account has no assigned bike that passes the displayed approval, active and
expiry checks. The specific production record cannot be determined from a
screenshot. The owner must check the actual assignment and document review;
changing a device does not satisfy those requirements. Rider compensation and
operator approvals and a healthy service are also required.

A desktop browser can go online when it supplies a real location with accuracy
within 100 metres. Permission, OS location services, HTTPS and the device's
location quality still matter. Some laptops cannot provide that accuracy.
The UI must explain that failure instead of substituting a manually selected pin
or treating a button click as proof of presence. A browser tab cannot guarantee
location updates when suspended or closed. Presence expires after 75 seconds
without a fresh server receipt; the current implementation is not an always-on
native background tracking service.

## Changes

- Use the availability PUT receipt immediately. Fence reads that began before
  the mutation, and ignore lower presence versions. A delayed refresh no longer
  leaves a successfully online rider displayed as offline.
- Add transactional `expected_version` checks and explicit heartbeat semantics.
  Heartbeats cannot start an ended shift. Once a record has received a versioned
  write, old unversioned clients must reload; they cannot undo an offline action.
  Only explicit offline intent may retry a version conflict, after a fresh read,
  at most twice. Online intent is never automatically retried.
- Keep a version per owned bike in the availability response so switching back
  to a previously used bike does not incorrectly send version zero.
- Ignore previous-operator presence when a bike has been reassigned. Preserve
  assignment, document, compensation, OTP, funding and trip state checks.
- Cancel pending logical GPS reads when a shift stops. Ignore callbacks from
  previous watches and prevent their cleanup from clearing a new lookup.
- Preserve API error codes in the HTTP adapter. Conflict, stale-fix and
  rate-limit handling now receive the information they already expected.
- Distinguish automatic heartbeats from deliberate availability changes in
  account-cache invalidation. Routine ten-second heartbeat writes no longer
  invalidate unrelated account reads or broadcast an account-change event.
- Reuse the dispatch-health result already calculated by public policy instead
  of calculating it twice per availability response. This is not a measured
  twofold reduction in database reads: the transaction store may cache reads.
- Explain assignment/review/inactive/expiry blockers, and align the UI's bike
  document window with the backend's 30-minute requirement. Align fresh GPS
  acceptance with the UI's 30-second future-clock allowance.
- Correct nearby-cab status contrast in dark mode, found during booking checks.

## Evidence and scope

Artifacts are under `/workspace/artifacts/go-reliability-2026-10-23`.
The dispatch harness processed 256 riders / 1,024 logical events using 16 local
workers. It injected 148 lost publish acknowledgements and four callback
replays. Every sequence committed once, with no lost events or residual holds.
Elapsed: 5.81 seconds. Commit plus duplicate-check latency: p50 4.591 ms,
p95 107.779 ms, p99 331.609 ms. This uses temporary SQLite and an in-memory
broker, not production Firestore or Pub/Sub; it is a correctness/fault benchmark.

New HTTP regression cases cover competing version writes, delayed heartbeat
rejection, legacy-tab fencing, fresh-version heartbeat rejection after offline,
reassignment privacy, desktop/mobile requests, inaccurate/future GPS rejection,
continued active-trip telemetry while offline, and switching bikes.

Browser tests use the actual rider component and Chromium desktop geolocation.
They exercise an older read held across an online mutation, a committed heartbeat
with delayed acknowledgement during an offline command, denied location,
failed writes, and preservation of error codes by the actual HTTP adapter.
Injected browser transport records are test data, not proof about a production
account. The separate fullstack bike test uses a real local HTTP API and database:
customer booking, passenger privacy, driver acceptance, pickup GPS, private OTP,
completion, free entitlement, paid fare and exact company cash receipt.

Reproduction (no remote load):

```sh
GOOGLE_APPLICATION_CREDENTIALS=/tmp/repaido-isolated-no-cloud.json REPAIDO_STORAGE=sqlite \
  backend/.venv/bin/python -m pytest backend/test_bike_presence_consistency.py -q
node --test web/tests/bike-location-session.test.mjs web/tests/action-feedback.test.mjs
node web/tests/bike-presence-races.browser.mjs
backend/.venv/bin/python scripts/bike_dispatch_load.py --riders 256 --workers 16
```

Browser tests expect local Vite on 127.0.0.1:5187 and Playwright/Chromium.
Verification results:

| Check | Result |
| --- | --- |
| Full backend suite | 1,850 passed; 103 skipped; 23 warnings. Optional emulator/broker/configuration tests are not validated by this run. |
| Final presence/lifecycle/assignment checks | 75 passed after the per-bike version refinement, including all nine new presence regressions. |
| Frontend unit suite | 403 passed, zero failed. |
| Desktop presence race tests | Passed, including the actual HTTP adapter's conflict code. |
| Rider lifecycle browser | Passed: reconnect, stable command retries, OTP rejection/recovery, GPS gating, salary receipt and company cash reporting. |
| Rider onboarding browser | Nine checks passed; 320px/dark/200% text, 485px, 44px targets, WCAG A/AA. |
| Local fullstack bike booking | Four workflow checks passed against real local HTTP/SQLite with external identity/routing fixtures. |
| cPanel production build | Passed; existing large-bundle warnings remain. |
| Broad Go browser | Booking/navigation and light/dark/200% accessibility checks completed after the contrast fix. The harness then timed out waiting for the separate home entry's `data-animated=true` assertion. It is **not** an all-green browser run; home decorative motion remains to investigate. |

Existing rider browser fixtures were corrected to use the current foreground
ride dialog, actual expiry/arrival data and the current cash-total presentation.
Onboarding tests isolate bike setup from an unrelated seeded cab request.
These changes do not weaken the production assignment or lifecycle gates.

## Capacity target and release gates

10,000 concurrently active people and 10,000 requests per second are different
workloads. For example, 10,000 foreground riders posting every ten seconds cause
about 1,000 location writes/second. Two ten-second rider dashboard reads add
about 2,000 reads/second, before payroll refresh, bookings or retries. If another
10,000 customers poll active trips every three seconds, that adds about 3,333
reads/second. Twenty-second discovery polls can add 500 requests/second.
These are request estimates, not database-operation counts or capacity proofs.

The current app uses bounded HTTP polling, not a new low-latency push fan-out
service. Public maps expose bounded/coarse nearby supply, while exact trip
locations remain account-authorized. Broadcasting every precise rider location
to every customer is neither necessary for discovery nor an acceptable privacy
model. A future push layer should authorize subscriptions per trip or coarse
cell, coalesce old locations, bound subscriber queues and disconnect slow
consumers, retaining durable ordered booking events separately from telemetry.
That infrastructure is not implemented by this patch.

The existing [resilience design](BIKE_RESILIENCE.md),
[worker pool](../infra/bike-runtime/README.md) and
[capacity planner](../infra/api-capacity/README.md) already provide bounded
admission, sharded health/funding records, per-rider ordering, durable outbox,
idempotent consumers, jittered recovery, routing caches and reviewed scaling
ceilings. Their presence in source is not proof of production deployment or
10k requests/second capacity.

Before claiming that target, use an isolated staging project with matching
Firestore indexes, worker topology, quotas and production-shaped data:

1. Define the workload mix, GPS cadence, active-trip ratio, hot pickup cells,
   session churn, latency budgets and an explicit daily cost ceiling.
2. Measure API p50/p95/p99, accepted/rejected throughput, admission saturation,
   Firestore reads/writes and retries, hot documents, routing quota errors,
   oldest broker message age, outbox age, worker lag and location freshness.
3. Ramp 100 → 500 → 1,000 → 2,500 → 5,000 → 10,000 requests/second only while
   latency, error and budget gates hold. Include a sustained soak and reconnect
   burst; report successful throughput separately from rejected traffic.
4. Inject lost responses, worker restart, one-zone failure, provider timeout,
   broker outage and slow consumers. Require zero double bookings, duplicate
   fare/earning effects or cross-account location disclosures. Verify recovery
   drains the backlog without disabling active-trip updates.
5. Set SLO alerts from measured baselines and an error budget; retain active-trip
   and financial operations during a pause of new bookings. Do not increase
   instance caps to conceal database contention or exhausted route quotas.

No 100× efficiency gain, 10k requests/second capacity, subsecond location delivery,
or production SLA has been established. No production load test was run.

Deploy the compatible API before the updated website in a requested release.
The API accepts existing clients until a presence record opts into versioning;
subsequent old tabs get a conflict and must reload. Do not roll back to an API
that ignores the version fence while the new client is serving. No new index
or database migration is required for these presence fields.
