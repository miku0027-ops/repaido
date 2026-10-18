# Repaidians activity cards — 18 October 2026

## Delivered behavior

- Activity posts use raised surfaces, layered shadows, a source-specific icon, a compact status panel and clear profile/record actions. Photo posts keep their existing layout and controls.
- Reviewed professionals show their canonical work rating, review count and completed-job count. Community members show their shared activity history without being presented as reviewed workers.
- Quick record opens up to three public completed jobs and one customer-review excerpt from the existing public professional API. It loads on demand and rechecks when reopened after one minute; it does not fetch a rich profile for every feed card.
- Non-professional authors can open their recent public activity history through the existing member-profile API. Profile actions open the actual author profile.
- Backend milestone projections include a source-derived phase, participant description and check time. Authors cannot submit these fields. Ride owners, drivers and passengers have distinct labels, and rides use ride-specific progress labels.
- Existing feed validation refreshes the record every 30 seconds while the view is visible. If a check is older than 90 seconds, the card stops presenting it as current activity. Status is separate from an offer of availability.
- Only source projections and existing public record fields are shown. Private record IDs, addresses, phone numbers, passenger details and GPS remain outside the public activity card.
- Touch controls retain 44 px minimum dimensions. Status has a text label as well as colour; keyboard focus, light/dark colours, enlarged text and reduced motion are supported. The activity dot animates briefly rather than continuously.

## Verification

| Check | Result |
| --- | --- |
| `npm --prefix web test` | 342 passed; none failed or skipped |
| `npm --prefix web run build` | TypeScript and Vite build passed |
| `NO_GCE_CHECK=true backend/.venv/bin/python -m pytest -q backend/test_repaidians_milestones.py backend/test_repaidians.py` | 37 passed; one existing Starlette deprecation warning |
| `repaidians-activity.browser.mjs` | Passed against a local HTTP API with isolated SQLite records |
| `git diff --check` | Passed |

The browser test covers source-backed progress and credibility, passenger/professional separation, on-demand reads, a failed request followed by retry, public work history and reviews, profile navigation, and a backend transition from active to completed. It audits 320, 390, 472 and 768 px widths, both themes, 200% text at 320 px, touch dimensions, unobscured actions and automated WCAG/contrast rules. An explicit computed-colour check also covers profile buttons that are clipped by the feed scrollport during the broader accessibility scan.

Browser evidence: `/tmp/repaidians-activity-IGmHlI`, including `report.json` and screenshots. Logs: `/tmp/activity-browser-final.log`, `/tmp/activity-backend-final.log`, `/tmp/activity-web.log`, `/tmp/activity-build-final.log`.

The first new test run exposed two incomplete fixtures (a ride without origin coordinates and profile editing after worker suspension); both fixtures were corrected without weakening application permissions. Visual inspection then caught the dark-mode CTA text colour and shared-theme shadow override; both were corrected and the browser/build checks rerun.

## Release scope and limits

No new data collection, database index, dependency or background service is required. Ratings are service-work evidence, not an invented ride rating or credibility score. Existing bounded-record API flags are disclosed when a quick record contains a partial history. Vite retains its existing dependency and large-chunk warnings.

Validation was local; this is not a physical-device or complete manual accessibility certification. The production website has not been deployed or changed by this task.
