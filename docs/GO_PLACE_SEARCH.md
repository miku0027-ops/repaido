# Go pickup and drop-off search

The inline Go editor uses the existing referrer-restricted Google Maps JavaScript
browser key from `/api/operations/bike-rides/map-config`. No server routing key or
new secret is sent to the browser. Bike, cab, self-drive and rental use the same
editor. The general service-address picker remains separate.

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

## Cab browsing map and Locate me

The Go cab map requests the existing public availability feed for its current
area before pickup confirmation. Locating the customer changes the discovery
centre without editing or confirming ride stops. Approved cabs appear only when
the operator has enabled public availability and is sending fresh positions.
Markers retain the server's approximate grouped areas and counts; private trip
GPS is not used for public discovery. The existing 20-second foreground poll,
75-second position expiry, offline clearing and account isolation are preserved.
Empty, loading and failed reads have distinct messages and an explicit refresh.

The circular Locate me control requests a fresh device reading only when tapped,
recentres the camera, and displays a blue dot. It handles denied permission and
ignores late GPS callbacks after leaving the screen. Availability refreshes do
not move the camera after manual panning. `go-cab-nearby.browser.mjs` verifies
these behaviors, expiry, failure recovery and 320/465 px layouts;
`map-motion.browser.mjs` verifies the existing lifecycle camera behavior.

The stop picker reuses the same circular Locate me control as the browsing map,
replacing the separate location text row. Its action is delegated to the picker
so GPS accuracy, reverse-geocoding, revision cancellation and explicit stop
confirmation remain intact. Browse-map location continues to recenter only.
Both placements share hover/focus styling, a 44 px touch target and reduced-motion
aware loading feedback. Map attribution remains outside the controls.
