# Home discovery and live mobility UI — 18 October 2026

## Scope

- Square home service tiles with artwork and a short category name. Promotional captions, badges and ticker dots no longer compete on every tile; full accessible labels and existing service actions remain.
- A continuous greeting/search surface with translucent glass styling, a static blur and a finite four-second entrance effect. Reduced-motion preferences disable the effect; an opaque fallback supports browsers without backdrop blur.
- Compact Quick discovery with search first, six photo categories and a professional-type dropdown. Existing search, location, filtering and booking requests remain connected.
- Self-drive estimates use independent price rows, separate advance/balance panels and expandable route details. Long explanatory text cannot squeeze every price label into a narrow column. Backend quotes and payment calculations are unchanged.
- Shared rides bring the next drop-off action, arrival state and map ahead of expandable passenger, fare and journey details. Customer and operator controls remain distinct.
- Arrival cues use the same backend geofence as drop-off: GPS accuracy at most 100 m, received within 75 seconds, captured within 120 seconds, and distance plus uncertainty within 300 m. Missing, stale or uncertain readings cannot produce a green confirmation. Drop-off and completion still require deliberate operator actions.
- Destination notifications are persisted once per passenger/recipient. Delivery rechecks ride state, consent, location and authorization. Transport sounds are short, optional chimes rather than repeating alarms; repeated polls do not replay the same request.

## Completed checks

| Check | Result |
| --- | --- |
| `npm --prefix web test` | 342 passed, none failed/skipped |
| `npm --prefix web run build` | TypeScript and production Vite build passed |
| Backend destination, mobility journeys, departure alerts, local business and transport discovery tests | 46 passed; three existing deprecation warnings |
| `elastic-home.browser.mjs` | Passed: search modes, filters, account/cache guards, settings focus, reduced motion, real App greeting/search join and square tiles at 320/472/573 px |
| `mobility-forms.browser.mjs` | Passed: responsive shared/cab forms, route changes, real join request, self-drive quote, licence upload and booking submission |
| `shared-ride-mobile.browser.mjs` | Passed: owner/driver/customer lifecycle, rescheduling, boarding, green arrival for driver and customer, drop-off, completion, payment reporting/receipt and cancellation |
| `git diff --check` | Passed |

Browser suites use Chromium and local HTTP backend fixtures. They check small-screen reflow, light/dark themes, enlarged text, unobscured controls and automated WCAG/contrast rules. Shared-ride coverage includes widths 320, 390, 465, 584 and 1440 px and 200% text. Automated accessibility checks do not constitute a full manual accessibility certification.

Backend command:

```sh
NO_GCE_CHECK=true backend/.venv/bin/python -m pytest -q \
  backend/test_shared_destination.py backend/test_mobility_journeys.py \
  backend/test_shared_departure_alerts.py backend/test_local_business.py \
  backend/test_transport_discovery.py
```

Browser commands use `NO_GCE_CHECK=true` and the installed Playwright module supplied through `PLAYWRIGHT_MODULE`; the preview server is on port 5187. Home checks additionally use `ELASTIC_PREVIEW_ORIGIN=http://127.0.0.1:5187`.

## Evidence and limits

- Home screenshots/report: `web/test-results/elastic-home` (generated, ignored).
- Rental evidence: `/tmp/repaido-mobility-forms-fS01Pv`.
- Shared-ride evidence: `/tmp/repaido-shared-mobile-xUMa45`, including separate driver and customer green-arrival screenshots.
- Unit/build logs: `/tmp/ride-home-web-tests.log`, `/tmp/ride-home-backend-final.log`, `/tmp/ride-home-build-final.log`.
- Map overlays, route pins and location state were exercised. External street-map tile rendering, physical-device GPS, native background delivery and audible output on real devices were not certified by these fixtures.
- Vite retains existing large-chunk and dependency warnings. No dependency, schema, container or deployment configuration change is needed for this batch.
- Development changes only: no production deployment, push or credential change was performed.
