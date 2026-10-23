# Go pickup and drop-off search

The inline Go editor uses the existing referrer-restricted Google Maps JavaScript
browser key from `/api/operations/bike-rides/map-config`. No server routing key or
new secret is sent to the browser. Bike, cab, self-drive and rental use the same
editor. The general service-address picker remains separate.

## Google Cloud configuration required before release

Read-only production-origin checks on 23 October 2026 found:

- Maps JavaScript renders correctly.
- **Places API (New)** (`places.googleapis.com`) is disabled in project
  `133610574058`.
- The existing key also receives `REQUEST_DENIED` for browser geocoding. Review
  **Geocoding API** (`geocoding-backend.googleapis.com`) enablement and the key's
  API restrictions.
- Legacy Places autocomplete is denied too; it is not a working fallback.

An administrator must enable Places API (New) and Geocoding API and allow them on
the existing browser key, retaining its production HTTP-referrer restrictions.
Keep Maps JavaScript API enabled. Do not substitute the server routing key or
remove referrer restrictions. No API or key configuration was changed by this
feature's implementation.

After configuration, verify autocomplete, a selected place's coordinates/address,
and reverse geocoding from `https://repaido.com/go?ride=bike` and the cab route.
Local SDK fixtures verify the integration but do not prove cloud authorization.

## Search and pin behavior

- Google autocomplete uses a 30 km location bias and distance origin around the
  current stop or pickup area. It is a bias, not a city restriction. Google ranks
  relevance; the app does not guess a pin from a typed string.
- Search starts after two characters and a 300 ms debounce. One autocomplete
  session token is used until a selection; only the selected place requests its
  location, display name, formatted address and address components.
- Search/selection/GPS revisions discard late results after edits, closing,
  switching tabs or changing accounts. Provider results are held only in memory.
- A named place must be selected and its pin explicitly confirmed. Map taps and
  GPS retain their actual coordinates even if reverse geocoding returns a nearby
  street centroid. GPS accuracy remains visible for review.
- If search/geocoding is unavailable, a user can select a map pin or use GPS and
  supply a short landmark. A failed lookup never becomes a fabricated result.
- Confirming a changed stop invalidates the old route, quote and consent. Backend
  service radius, route distance, fare and booking validation still apply.

## Verification

`web/tests/go-location.browser.mjs` covers inline bike/cab search, debouncing,
keyboard selection, map coordinates, GPS, fallback, stale-request cancellation,
320/495 px layouts and 200% text. `web/tests/repaido-go.browser.mjs` covers real
isolated API quote/booking workflows. Shared-card tests cover own-seat events,
expired arrival GPS, payment reporting and account isolation.
