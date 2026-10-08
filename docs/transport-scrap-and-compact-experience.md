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
