# Adaptive home discovery

The home discovery card now supports rides, repairs and marketplace journeys.
Customers can switch explicitly at any time. Refurbished products, nearby used
items, tool rentals and selling each have their own compact colour treatment,
original vector illustration and entry into the existing transaction flow.

## Placement and rotation

`homeDiscoveryPlan.mjs` computes a stable public plan from the city, India date
and a two-hour slot. It does not use an account ID, keywords or exact coordinates
as the public shuffle seed. The marketplace mode has a separate rotation to avoid
always advertising the same two modes when the marketplace family appears.

The agreed peak windows remain authoritative for suggested discovery:

| India time | Suggested focus |
| --- | --- |
| 07:00–09:00 and 17:00–19:00 | Rides |
| 10:00–12:00 | Repairs |
| Other times | Consented recent interests, then public rotation |

Repeated interest in a repair category can promote the existing six service
buttons above the discovery card. Without established interests, the public plan
also occasionally promotes that grid. `HomeDiscoveryLayout` changes the actual
order of keyed siblings so keyboard reading order matches the visible order.
Moving the same components preserves their internal state and prevents duplicate
catalogue subscriptions. The generic second banner is omitted from the movable
grid; eligible campaign offers still use the existing offer engine inside it.

An interaction or focus within these home slots holds the current placement for
that home visit. Typing, a category selection, a booking or an open picker does
not trigger automatic rearrangement. Returning to Explore starts a new placement
decision. An untouched page may refresh its plan after at least 30 minutes in the
background, provided no dialog is open. An untouched visible page checks its
local clock once a minute and changes its plan only at a slot or peak boundary;
the check itself makes no API call. There is no rapid randomisation timer.
Manual family switches keep the repair draft. Explicit repair-category selection
clears the text filter and requests that category instead. Duplicate used-item
and refurbished shortcuts are hidden while their marketplace card is selected;
the remaining quick actions remain available.

## Real catalogue and professional data

| Selected view | Source | Next action |
| --- | --- | --- |
| Refurbished | `GET /operations/products/catalog`, refurbished and positive stock only | Existing product detail and checkout |
| Used items | `POST /operations/market/search`, `second_hand`, confirmed pin, 10 km | Existing public owner-listing detail |
| Rentals | `GET /operations/rentals/catalog`, available units and selected city | Existing rental review for the selected inventory ID |
| Sell | No preview catalogue request | Existing used-item listing editor |
| Repairs | `POST /operations/discovery/search`, category/query and optional role | Existing service or Home request with the selected professional |

The previews display at most two inventory rows. Prices, warranty text, deposit
and rental period come from the catalogue response. Illustrations do not imply
stock or live activity. Empty and failed requests have explicit states and retry
actions. A missing location immediately removes previous proximity results.

Repair-category buttons load matches when the repair view opens, without
requiring a text submission. Customers can filter agents or specialists. The
existing server still requires approval, online availability, a worker location
no older than 15 minutes, acceptable accuracy, category eligibility and the
smaller of the professional's travel limit and six-kilometre booking coverage.
Exact worker coordinates, phone and private address are not returned. No review
score is invented. Availability is confirmed when the professional accepts.

Professional cards keep the service selection in a disclosure and initially show
two matches, with an explicit option to reveal the rest. Booking forwards the
actual `preferred_worker_id`; opening a profile does not assign the worker.

The selected view alone issues its discovery requests. Successful read responses
use bounded, account- and location-scoped memory caches for 30 seconds. Changing
category, role, account or area changes the read key. An explicit retry refreshes
the same key; merely revisiting a hidden view uses its fresh snapshot. Late
responses cannot replace the active request. There is no persistent storage of
professional or exact-location search results, background auto-save or success
dialog for catalogue reads.

## Personalisation and compatibility

Discovery consent version 2 continues to authorise the existing service and
transport interests. It does **not** authorise recording marketplace behaviour.
Version 3 explicitly includes marketplace browsing and home placement; existing
version-2 customers can choose “Include marketplace suggestions”. Turning
personalisation off clears interests. Reset preserves the authorised scope while
clearing history. Downgrading to version 2 removes marketplace categories,
signals and recent category markers.

Only the four named marketplace categories are accepted as marketplace signals:
`market_refurbished`, `market_preowned`, `market_rentals`, `market_sell`.
The existing authenticated event endpoint validates consent, deduplicates event
IDs, rate-limits influence, bounds scores and expires interests after 30 days.
It saves category aggregates rather than raw searches, locations or listing
contents. Public rotation and passive impressions do not record behaviour.

The personal feed adds `market_personalised`, `preferred_market_mode` and
`repair_category_visits`, and can return `marketplace` as its preferred discovery
focus. Existing service/campaign/hiring personalisation accepts both valid consent
versions so opting into the new scope does not disable existing recommendations.
Older clients can still submit version-2 consent and the old event shapes.

## Design and verification

The components use Poppins, shared navy and light coloured surfaces, compact
spacing, visible keyboard focus and 44-pixel interaction targets. Decorative
entry animations are finite; selection, hover and press states are local to the
control. Reduced-motion settings disable those transitions and leave map
geometry intact. Existing service-card motion still has its pause control and
stops offscreen or when the document is hidden.

The supplied `codex_astra_frontend_specification.pdf` is used as compatible
design guidance for this home module: three intent choices, local selection
state, progressive disclosure, read-only previews, immediate switch feedback,
and human-readable failure/retry states. Parse failures and network exceptions
do not expose raw server text in the new marketplace or repair preview.
The card's settings button opens the existing personalisation controls in a
compact right-hand drawer. Closing it restores focus and the current discovery
draft; adjusting a preference does not navigate away from the home workflow.
Repaido's Poppins tokens, brand palette and existing booking/payment flows remain
authoritative; the document's alternate fonts, Stripe funnel and example
infrastructure endpoints are not introduced as product requirements.

Local validation:

- Frontend unit suite: 200 tests, including public rotation, consent gating and
  exact market-intent recognition.
- Discovery, hiring discovery/recommendations and promotion backend suite: 79
  tests, including scope upgrades, reset/downgrade, actor isolation and category
  versus specialist filtering.
- `elastic-home.browser.mjs`: real isolated SQLite API, all four catalogue/detail
  flows, selected-professional booking and receipt, layout-node preservation,
  draft retention, cache reuse, delayed response protection, consent and account
  isolation, missing location and silent idle behaviour. The real App entry also
  checks a single settings drawer, Escape dismissal and focus restoration beside
  the notification panel; these overlays use distinct React keys.
- Responsive checks at 320, 471, 768 and 1280 pixels, 200% text, light/dark themes,
  keyboard navigation and reduced motion. Axe's normally disabled
  `color-contrast-enhanced` rule is explicitly enabled and confirmed to run.
- Existing home-offer browser regression: eligibility, promotion selection,
  restored/removed discounts, booking payload, account-switch races and idle
  notifications remain working.
- TypeScript and production build, plus a check of the actual App home against
  the isolated API. Test adapters and fixture identities do not enter the
  production bundle.

These checks do not measure production cold-start latency, validate live shop
stock independently, or establish a full WCAG conformance audit.

## Release status

Development only. No Cloud Build, Cloud Run revision, Firebase Hosting update,
cPanel upload or production-trigger branch push is part of this task. Include
this change with the pending Market and scrap changes in the next explicitly
requested release. Release the compatible API before the web bundle that submits
version-3 consent, and update both cPanel and Firebase Hosting if the Android
wrappers still load the Firebase site. No database migration or new cloud service
is required for this feature.
