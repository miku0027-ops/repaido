# Go pickup and drop-off search

The inline Go editor uses the existing referrer-restricted Google Maps JavaScript
browser key from `/api/operations/bike-rides/map-config`. No server routing key or
new secret is sent to the browser. Bike, cab, self-drive and rental use the same
editor. The shared service-address picker and address-only forms use the same
Google search service; see [app-wide location search](APP_PLACE_SEARCH.md).

## Google Cloud configuration

Read-only production-origin checks on 23 October 2026 found:

- Maps JavaScript renders correctly.
- **Places API (New)** (`places.googleapis.com`) is disabled in project
  `133610574058`.
- The existing key also receives `REQUEST_DENIED` for browser geocoding. Review
  **Geocoding API** (`geocoding-backend.googleapis.com`) enablement and the key's
  API restrictions.
- Legacy Places autocomplete is denied too; it is not a working fallback.

The administrator enabled Places API (New) and Geocoding API on 23 October
2026. A subsequent production-referrer preflight now reports
`API_KEY_SERVICE_BLOCKED`, rather than `SERVICE_DISABLED`. The existing browser
key must allow both services in its API restrictions, retaining all existing
API targets and production HTTP-referrer restrictions.
Keep Maps JavaScript API enabled. Do not substitute the server routing key or
remove referrer restrictions. API enablement was performed by the administrator in Cloud Shell; browser-key
restrictions have not yet been changed or verified.

After configuration, verify autocomplete, a selected place's coordinates/address,
and reverse geocoding from `https://repaido.com/go?ride=bike` and the cab route.
Local SDK fixtures verify the integration but do not prove cloud authorization.

## Verified configuration fix · 24 October 2026

The existing `repaido-web-maps` key now allows Maps JavaScript, Places API
(New), and Geocoding. Its four production website referrer restrictions were
preserved. API enablement and active billing were verified. Production-origin
Places autocomplete and selected-place details returned HTTP 200 with actual
Balasore results and coordinates. This configuration change needed no website
release. The earlier SERVICE_DISABLED/API_KEY_SERVICE_BLOCKED findings above
are historical, not the current configuration state.

## Search and pin behavior

- Google autocomplete uses a 30 km location bias and distance origin around the
  current stop or pickup area. It is a bias, not a city restriction. Google ranks
  relevance; the app does not guess a pin from a typed string.
- The compact inline search sheet uses warm yellow for pickup and mint for
  drop-off. Google results remain keyboard selectable in a bounded list; failed
  searches offer an explicit retry without clearing the query.
- Large projected pins anchor their tip to the actual coordinate. Only the head
  animates on entry; a three-cycle pulse stops automatically. Reduced-motion
  preferences disable both animations. Panning does not silently change a
  selected location.
- “Use map centre” selects the current camera centre, supporting map keyboard
  navigation as well as tapping. Subsequent searches use the selected point as
  their nearby bias. Confirmation still requires a resolved or entered address.
- Search starts after two characters and a 300 ms debounce. One autocomplete
  session token is used until a selection; only the selected place requests its
  location, display name, formatted address and address components.
- Search/selection/GPS revisions discard late results after edits, closing,
  switching tabs or changing accounts. Provider results are held only in memory.
- The ride picker has no City input. City metadata comes from the selected
  place or the current service area; map coordinates still control coverage.
  Missing provider locality alone does not request manual address entry.
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

The refined picker passed its browser checks at 320/495 px and 200% text,
including retry recovery, exact projected coordinates, map-centre selection,
keyboard selection, and reduced motion. A separate check used the real Google
SDK and map tiles with the local UI: the large pin projected correctly, with no
JavaScript errors. Search remained blocked by the browser key's API allowlist.
Evidence is saved in `/workspace/artifacts/go-place-search-2026-10-23/`.

## Route entry and Locate me

The Go bike, cab, self-drive and rental booking forms open without a planning
map. Selecting pickup or drop-off mounts the inline location editor with its
search, map, pin and circular Locate me control. Returning to the form removes
that editor map. Live journey tracking maps are retained.

Cab availability counts still come from the existing public feed for the pickup
or current area, with foreground polling, expiry, account isolation and retry.
The form no longer fetches a map just to display those counts. Bike nearby-marker
polling is disabled when its planning map is not used. Route validation, quote
calculation and booking remain unchanged.

The editor's Locate me control requests fresh device GPS only when tapped,
resolves its address, displays accuracy, and keeps explicit stop confirmation.
`go-location.browser.mjs` verifies that no map mounts before editing a stop;
`go-cab-nearby.browser.mjs` verifies map removal on return, availability refresh,
and full-width forms at 320/465/1100px. Desktop layouts no longer reserve an
empty map column. These source changes await deployment.
