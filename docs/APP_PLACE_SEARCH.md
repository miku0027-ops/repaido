# App-wide location search and traffic handling

Implementation date: 24 October 2026. These source changes are not deployed.
The production Maps key permission fix is already applied; this is a separate
application release.

## Shared location entry

`PlaceSearch` and `ridePlaces.ts` use the existing referrer-restricted Google Maps
browser key. Searches are debounced for 300 ms, start at two characters, show at
most five results, and use a 30 km bias rather than a city boundary. Each editor
has its own autocomplete billing session. Only selection fetches the place's
address, locality, postal code and exact coordinates. Neither a search string
nor a result preview is treated as a confirmed booking location.

| Flow | Integration |
| --- | --- |
| Customer service area, service booking, home plans, hiring discovery | Shared `LocationPickerModal`, address lookup and map confirmation |
| Partner/workshop/shop base, transport, shared journeys, scrap, cleanup | Shared picker; existing validation and permissions still apply |
| Marketplace search area, item location, local leaderboard | Shared picker in area mode; no booking address is implied |
| Retail cart, wholesale RFQ, rental delivery, properties, checkout | Inline shared search fills existing address fields |
| Hire booking | Selected address, city and coordinates travel together in the request |
| Shop application | Address, city, PIN code and coordinates filled together; map refinement available |
| Private projects, contract work sites, community tender site text | Search fills the existing site address fields |

Plain text city/category filters are still filters. Verified driver presence,
arrival checks and optional fresh-device-location checks still require real
device readings; a searched place is never presented as GPS evidence. Selecting
another contract site invalidates its previous optional discovery GPS selection.

The service picker keeps manual address editing, GPS, map adjustment and an
advanced coordinate section. A selected result requires entrance confirmation;
map/GPS points retain their exact coordinates when reverse geocoding returns a
street centroid. Closing, changing the query or manually editing the address
invalidates older lookups. Pending search text blocks native form validation
until a result is selected or the search is cleared. Retail's explicit payment
button has the same pending-search gate.

## Bounded search traffic

Google search is a direct interactive read, not a durable job. The browser SDK
loader and Places library initialization share one pending promise per page;
failures reset for an explicit retry. There is no cross-user autocomplete cache,
disk cache or persistent queue of search text or provider suggestions.

`placeRequestQueue.mjs` provides, per browser page:

- Four maximum SDK calls in flight, with at most two autocomplete calls.
- Selection/geocoding priority, leaving capacity when autocomplete is busy.
- At most sixteen queued calls; excess requests get a retryable busy message.
- Five-second queue expiry. Canceled/obsolete queued work is removed, not replayed.
- Fifteen-second caller timeout. The SDK cannot cancel an already dispatched
  call, so its slot remains occupied until it really settles. This prevents
  timeouts from causing unbounded additional traffic.
- No automatic retry storm on quota, authorization or provider failures.

These are per-page bounds, not a project-wide QPS limiter. Google project quotas
and billing limits still govern total traffic. Do not use extra keys to evade
quotas. Existing backend routing pools separately coalesce identical requests,
cache bounded route/ETA reads briefly, and open a circuit after provider failure.
Booking state, fare acceptance and reservation authority stay transactional.

## Worker isolation and horizontal scaling

The existing bike outbox uses Pub/Sub ordering keys, or Kafka partitions when
explicitly configured, to serialize work per rider. Multiple workers share the
same subscription/consumer group; a transactional consumed-event record prevents
duplicate effects. Provider publishing stays outside retried database writes.
Kafka and Pub/Sub are alternate transports, not simultaneous delivery paths.

Each Pub/Sub subscriber now owns a callback thread pool. Defaults preserve the
SDK's prior ten-thread concurrency and 32 outstanding messages. The settings
`REPAIDO_BIKE_DISPATCH_CALLBACK_WORKERS` (1–32) and
`REPAIDO_BIKE_DISPATCH_MAX_MESSAGES` (workers–128) allow controlled tuning. Invalid
settings fail closed. Flow control also caps pending message bytes at 1 MiB.
Shutdown waits for executing callbacks; the SDK returns queued, unstarted
messages for redelivery. Failed effects are not acknowledged.

The separate work-event worker retains its existing durable outbox/Cloud Tasks
wakeups. Route and pickup-ETA pools remain independent. Search queries do not
compete with booking callbacks in these workers. This change does not provision
Kafka, alter IAM, increase runtime instances, or activate the prepared two-zone
worker infrastructure. See [dispatch](BIKE_DISPATCH.md) and
[resilience](BIKE_RESILIENCE.md) for the existing deployment contracts.

Before claiming a traffic target, measure actual production-like concurrency,
quota headroom, latency percentiles, Firestore contention, oldest unacknowledged
message age, redelivery rate, worker health and costs. Tune instance count and
callback concurrency together within the database/provider budget. No 10,000
requests/second or 100× improvement has been established by local tests.

## Verification

- Six queue tests cover burst capacity, cancellation, expired work, provider
  failure, independent sessions, and timeouts retaining real capacity.
- Service-place browser checks cover saved address/pin consistency, late results,
  map adjustment, retry/empty results, close/reopen, the real shop/private-project
  forms and WCAG AA at 320/490px with 100/200% text.
- Existing Go search and location-lifecycle browser checks cover ride selection,
  GPS failures, late callbacks, precision and reduced motion.
- Dispatch/resilience/work-event tests cover duplicate effects, callback bounds,
  shutdown, worker recovery, route-cache single-flight and backpressure.
- Provider behavior in browser tests is mocked; they do not constitute a Google
  quota test, real booking load test, or proof of production capacity.
