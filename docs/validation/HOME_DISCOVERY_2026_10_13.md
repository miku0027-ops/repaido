# Home discovery and selected campaign offers

Development branch: `development/home-discovery-offers`. No deployment or cloud build was submitted for this change.

## Customer experience

- Light, service-specific cab/shared/self-drive/rental surfaces with compact mode buttons, a shorter illustrated action card and collapsible nearby results. Collapsed nearby results stop polling. Search drafts survive switching Rides/Repairs.
- Branded greeting with one location line. The hanging offer tag uses a currently eligible, published campaign and its real end date. Without a campaign it shows a brand message, not a claimed sale.
- Blue category rail with wrapping labels, selected states, keyboard access and hover/press feedback. No moving location ticker or clipped category marquee.
- Eligible service tiles always show the exact catalogue service, original price, discounted price, saving and expiry. They work on a first visit and stay stable while adjacent service illustrations rotate. Gardening does not inherit an unrelated home-cleaning offer.
- Existing Poppins fonts and illustration assets; bounded entrance/selection animation, pause controls and reduced-motion support. Background campaign receipts do not display “changes saved” or invalidate booking caches.

## Pricing and saved selection

Use the existing company campaign controls to publish funded offers for up to 180 days. The new `maximum_discount_bps` control defaults to 2500 and may be lowered; the server always enforces a hard 25% ceiling. Existing worker pay, bonus reserve, minimum retained margin, risk allowance, city, audience, consent, budget, expiry and redemption checks still apply to feed, quote, selection and booking. Separate Gold/cleanup loyalty benefits are unchanged.

The existing recommendation engine ranks approved campaigns using consented saved interests and eligible purchase history. The tile chooses an eligible saving for its service category. This does not invent individual prices, automatically fund campaigns, or forecast six-month profit. No fake sale periods, timers or scarcity counters are used.

`POST /operations/campaigns/select` saves intent idempotently under a hash of authenticated account, service and city. `GET /operations/campaigns/selection` restores a still-eligible selection; `DELETE` clears it. Clicks do not reserve campaign funds or consume redemptions. Booking performs the transactional reservation and checks the reviewed campaign version, discount and catalogue price. Old clients may omit the added quote fields; their previous retry fingerprints remain compatible.

The home greeting, grid and promotion rail share one account/location-scoped campaign feed with in-memory caching. Old request results cannot replace a new account's feed. A selected offer from one signed-in account is not automatically selected for another account.

## Local verification

- Web: `npm --prefix web test` (183 tests) and `npm --prefix web run build`.
- Backend: `backend/.venv/bin/python -m pytest backend/test_promotions.py backend/test_operations.py -q` (29 tests).
- Browser: start the documented Vite dev server, then run `node web/tests/home-discovery.browser.mjs` with `PLAYWRIGHT_MODULE` pointing to an installed Playwright package if it is not on Node's module path. The script starts an isolated SQLite API and test session adapter; no production accounts, campaigns or payments are modified.
- Browser checks cover light/dark themes, 320/390/487/1440 px widths, 100%/200% text, enhanced contrast, mode switching, draft retention, saved offer removal/restoration, account isolation, a delayed old-account response, booking receipt and silent idle refresh. Returning-visitor card motion and pause/reduced-motion states are checked separately.

The production build retains the repository's large-chunk advisory. External provider delivery, production campaigns and production deployment were not tested by these local checks.
