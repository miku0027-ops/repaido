# Transport, scrap and compact app workflows

Customer destinations are Market → Cabs & cars and Market → Sell scrap. Registration offers cab owner, driver and scrap buyer roles in the worker portal. Each approved business has its own requests, calendar, vehicles/rates or payments, and profile desk.

## Transport operation

1. The business submits its private documents and real operating base. An operator reviews the originals and records an evidence reference and the earliest applicable document expiry in Operations → Transport & scrap. Vehicles require their own document review.
2. The owner sets cab base/per-km rates, rental daily rate and included km, applicable GST, origin, availability and written terms. No default selling rate is published. Identity/vehicle changes require another review; rate changes invalidate outstanding quotes.
3. Customers choose dates, route and up to three approved vehicles within 8 km. Quotes use Google driving routes and display approach, journey and return legs. The first eligible acceptance atomically reserves both the vehicle and owner/driver, excluding overlapping bookings.
4. A verified ₹500 advance is credited toward the final fare; the minimum total is ₹500. A browser callback cannot mark payment received. Departure requires captured payment, valid approval and no financial hold.
5. The owner records pickup condition and odometer, then submits completion. Rentals use actual days and odometer distance with the accepted rate snapshot. The customer reviews completion before the remaining balance becomes payable.
6. Pre-start cancellation returns the advance through a retry-safe provider refund. Disputes pause collection and require an operator resolution; resuming preserves the customer's completion approval step.
7. Gateway collection and owner settlement are separate records. **Owner payouts are currently reconciled external transfers, not automatic payouts.** An operator verifies the destination bank details, makes the actual transfer through the business's banking process, and records its reference. The owner confirms receipt. The app does not initiate that external transfer or label an operator report as bank verification. No commission or deduction policy is assumed.

Existing `GOOGLE_ROUTES_API_KEY`, `REPAIDO_KYC_BUCKET`, Razorpay credentials and `REPAIDO_PAYMENTS_ENABLED` govern provider availability. Missing providers return explicit unavailability. There are no seeded business approvals, customer bookings, tariffs or production receipts.

## Scrap collection

Approved scrap buyers within 8 km receive collection requests. The assigned buyer records inspected grade, gross and tare weight in integer grams, per-kg price, scale reference and an actual private weighing photo. The customer accepts the itemized quote before collection/payment. A buyer's payment reference remains reported until the customer confirms receipt. It is never described as a gateway-verified payment.

## Existing workflows

- Hiring uses an image category rail, service-specific bottom sheets, a shared location picker, compact profile evidence, fixed profile action and staged request. The four-second banner is an illustrative photographic motion clip; it is not footage of a listed professional.
- Approved professionals can publish funded offers for their reviewed Home services and day-hire categories for up to two calendar months. Amounts must be chosen and published by the professional. Quotes retain the accepted offer; rematches use the new professional's offer. Coupons do not stack with these savings.
- Tracking preserves manual zoom, supports two-finger pinch and fullscreen, and exposes the real professional profile from the named marker. Distance is explicitly straight-line GPS distance, not a driving ETA. Behavior, quality and skills scores need specific verified review dimensions; punctuality needs a customer-verified arrival snapshot.
- Contracts have staged entry and lifecycle tabs refreshed from saved project state. Seven private PDFs cover summary, progress, payments, purchases, team/attendance, timeline and complete audit record. Reports use INR/IST and snapshot references. They distinguish reported expenses and gateway collections from confirmed receipts; they are not statutory tax invoices or audit certifications.

## Validation

From `backend`, run `REPAIDO_STORAGE=sqlite .venv/bin/python -m pytest -q`. From `web`, run `npm test` and `npm run build`. For browser checks, start Vite on local port 5187, then run `node web/tests/refinement.browser.mjs` and `node web/tests/customer-experience.browser.mjs` from the repository root with `PLAYWRIGHT_MODULE` set if needed. The scripts create isolated SQLite databases and local API servers, and do not use production accounts or payment providers. Preview entries under `web/tests` are excluded from the production bundle.


## Registered roles and scheduled shared journeys

The signed-in work portal resolves its registered category from `/operations/worker/me`.
An existing business application cannot change its role, and a service worker cannot
create a second business-category profile. Cab owners manage vehicles and tariffs;
approved drivers accept vehicle invitations and operate assigned journeys. Existing
contractor verification determines the contractor workspace. Account display metadata
never grants a backend permission.

Owners publish car/bike departures with real origin/destination pins, times, available
passenger seats, a total price per seat and written terms. Google Routes provides the
road polyline (`DRIVE` for cars, `TWO_WHEELER` for bikes). Search requires pickup and
drop-off within 2 km of that road and at least 500 m forward along it. The accepted
meeting pin is on the route; customers must check safe access. Search does not promise
walking navigation or pickup at a searched address away from the route.

Seat requests reserve capacity only upon atomic owner acceptance. Customers see the
decision in notifications and Bookings → Rides. Departure calendars include shared
journeys. Shared-ride fares are paid directly to the owner; passenger-reported payment
and owner-confirmed receipt are separate records, not gateway verification. The ₹500
credited advance/minimum continues to apply to dedicated cabs and rental quotes;
it is not imposed on owner-priced shared seats.

Boarding and drop-off require GPS received in the last 75 seconds within 300 m of the
agreed stop (including reported accuracy). Dedicated cab/rental pickup and completion
also require fresh GPS for new bookings. A bike offers at most one passenger seat.
The owner/driver cannot start a shared journey before marking a passenger boarded, or
finish while a passenger remains boarded. Vehicle, owner and assigned-driver conflicts
are checked across dedicated, rental and shared work, including active overruns.

## Tracking and family links

Tracking uses Leaflet and the same OpenStreetMap street tiles as the existing pickup and service-location maps. CARTO tracking URLs returned an “API key required” image; those URLs were replaced in customer, shared-ride and shop-agent tracking, with attribution preserved. Driver phone readings and installed
vehicle tracker readings are labelled; renter phone coordinates are never labelled as
vehicle GPS. Web sharing requires the page to remain open. The existing Agent Android
foreground tracking service uses the scoped, expiring native capability issued by
`/journeys/{rides|shared}/{id}/tracking-session`, through the existing tracking endpoint.
Location consent and current approval are checked on the server. Readings older than
75 seconds disappear from the live map. Map updates preserve user zoom.

A passenger can create a random 256-bit family link for their boarded, in-progress
journey. The browser link keeps the token in its fragment. Guest reads require no
account, use no-store/referrer protection, contain no customer contact details, and
recheck the journey and passenger state every time. Drop-off, cancellation, completion,
revocation or a 24-hour maximum lifetime invalidates access. Creating another link
revokes the earlier one. Server storage contains only token hashes.

A rental owner's installed tracker is an external hardware prerequisite. Pairing in
Vehicles → Driver & installed tracker issues a 90-day rotating device secret. The
installer sends HTTPS `POST /api/operations/local-business/vehicles/{id}/telemetry`
with `X-Vehicle-Token` and JSON `{lat,lng,accuracy,captured_at}` (Unix seconds, precise
GPS under 100 m, at most 120 seconds old). Never put the secret in a URL or logs.
The server accepts this only for an active booking; rental telemetry additionally
requires the renter's explicit location consent. Without a device or phone reading,
the app shows waiting for location. Installing this software cannot locate a car
without a source of GPS telemetry.

## Day-hire activation and current production prerequisites

The policy editor now strips public readiness metadata before saving. Confirmed jobs
reserve the configured `day_hours`, rather than a hardcoded eight-hour interval.
The existing request → professional response → driving quote → customer confirmation
→ visit, completion, collection and settlement lifecycle remains in place.

The read-only production policy check during this change reports routing and payments
unconfigured and the day-hire policy disabled. Hours per day, applicable GST, membership
amount and final policy terms need business values. These must not be guessed. In
Operations → Day-hire policy, supply those values with a new version, after connecting
`GOOGLE_ROUTES_API_KEY` to Cloud Run and enabling the Routes API for that key. Runtime
secrets are preserved by Cloud Build; a code deployment does not create them. Payment
collection also needs the existing Razorpay credential/webhook setup and
`REPAIDO_PAYMENTS_ENABLED`. No fake route, payment, member, approved vehicle or price
is seeded to bypass these requirements. The cloud workspace currently has no usable
GCP outbound identity, so it cannot change production secrets or the policy store.

Additional validation: `backend/test_mobility_journeys.py` covers actual isolated HTTP
requests, capacity contention, guest link expiry/revocation, native capability checks,
role locking, owner/driver separation, rental telemetry consent, geofences and configured
day duration. `web/tests/journeys.browser.mjs` exercises real local owner publication,
customer search/join, acceptance notifications and maps, plus account and staged layouts
at 320/465/1440 px, light/dark themes and 100/200% text.
