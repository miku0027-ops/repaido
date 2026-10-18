# Compact discovery and contract workflow validation — 18 October 2026

## Implemented scope

- Repaidians transport discovery uses a compact horizontal rail with distinct shared-ride, cab and self-drive icons, visible pricing, layered shadows and restrained pointer hover motion. Keyboard arrows, Home/End and disabled end controls work. Cards open the existing booking flows with their actual route, vehicle and fare.
- The Help button sits entirely above bottom navigation with a 12 px gap. Customer pages reserve additional bottom space for its hit area. The home header has rounded lower corners and a subtle shadow.
- Customer contract cards now present status, location, start date, planned budget and proposal counts in a compact hierarchy. Full scope and skill details remain available through a disclosure. Lifecycle tabs scroll instead of splitting labels into broken words.
- Matching approved agents see customer requirement summaries in the Repaidians feed and professional contract panel. Verified contractors retain their matched-contract workspace and private proposal workflow. Related requested trades can discover a summary without gaining access to bid on the whole contract.
- An existing bounded background worker repairs legacy customer-query references in pages of at most 24 records using a durable `queries-v1` checkpoint. This allows older requests to reach the contractor panel without synchronous recipient fan-out.
- Activity and saved items open from a compact button into a dedicated window. Existing orders, rentals, viewings, notes, saved searches, preferences and navigation remain available. Business and apartment accounts use the same compact entry pattern.
- Service category and sort dropdowns stay side by side on ordinary 320 px and wider phone layouts. Large text can reflow to one column so selected labels remain readable. Shared browse controls use smaller typography, soft active highlights and short transitions while keeping 44 px touch targets.
- Repaido Home has layered photographic artwork, scene-specific copy and decorative scroll motion bounded to ±4 px. Existing Home actions and published prices remain connected. Slideshow Pause/Play, manual navigation, visibility checks and both system/app reduced-motion preferences remain supported. A hover/focus race that changed the Pause button before a click was corrected.

## Contract access and lifecycle

The new `requirements` discovery mode returns the existing safe opportunity projection. It excludes exact site/location details, full private scope, bids and negotiated terms. Discovery checks approved status, registered city, experience, matching trade or related requested skills, blocks, suspension and membership access.

Private document access, contractor review, full-contract eligibility, workforce interest, location consent and fresh-location requirements remain enforced by the existing contract APIs. The browser delegates authorized records to the full workspace, including owned requests and already closed records with submitted proposals. A discovery 404 does not prevent those private records from opening; the private endpoint checks authorization again.

The construction example with civil and electrical skills is covered by a backend regression: an electrician can discover the safe summary, but does not receive full-contract access or a matched full-contract listing solely from that related skill.

## Verification results

All checks below passed locally with isolated fixtures; no production customer records were modified.

| Check | Result |
| --- | --- |
| Frontend unit suite, `npm --prefix web test` | 342 passed, none skipped |
| Contract, discovery, integration and opportunity backend suites | 84 passed |
| Production frontend build, `npm --prefix web run build` | Passed |
| `compact-transport-shell.browser.mjs` | Compact geometry, real shared/cab/rental opening, keyboard/end controls, reduced motion, header corners and Help/navigation separation passed |
| `custom-contract-discovery.browser.mjs` | Customer request → contractor surfaces → private proposal → customer review passed; agent summaries, owned requests, closed-record links and responsive contract cards passed |
| `discovery.browser.mjs` | Phone dropdown layout, category filtering, real service actions, atomic filters, sorting, cache races and recovery passed |
| `home-boutique-motion.browser.mjs` | Photo rotation, persistent Pause, explicit Play, offscreen stop, manual navigation and reduced-motion changes passed |
| `saved-alerts.browser.mjs` | Compact activity window, actual record navigation, focus restoration, account isolation, quiet hours and saved-data races passed |
| `git diff --check` | Passed |

Browser coverage included phone, tablet and desktop widths as applicable, 200% text, both themes and automated accessibility checks. Catalogue, Home, compact rail and contract-card checks included enhanced contrast checks; activity/preferences checks included WCAG AA rules. These checks do not constitute a complete manual accessibility certification.

Backend validation used:

```bash
NO_GCE_CHECK=true backend/.venv/bin/python -m pytest -q \
  backend/test_custom_contracts.py \
  backend/test_custom_contract_discovery.py \
  backend/test_custom_contract_integration.py \
  backend/test_repaidians_opportunities.py
```

The backend reported two existing warnings, including the Firestore SDK positional-filter warning. The successful frontend build still reports existing mixed static/dynamic imports and large bundle chunks; this batch does not resolve application-wide bundle size.

## Release state

These changes are saved locally on the development branch. They have **not been pushed or deployed**. No production credentials, environment configuration, cloud capacity, new service or Firestore composite index was changed. Live repaido.com behavior still requires a separately requested release and post-release verification.
