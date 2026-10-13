# Engineering console validation — 13 October 2026

Local development only. No production service, deployment trigger, IAM grant,
Firebase claim or customer record was changed.

| Check | Result |
| --- | --- |
| Python security, source mapping, collectors, account grants and release checks | 25 passed |
| Frontend graph/filter/export/evidence/motion tests | 7 passed |
| TypeScript and Vite production build | Passed; nonblocking bundle-size advisory |
| Python dependency compatibility | `pip check` passed |
| Chromium at 1440px and 390px | Canvas, filters, connections, source excerpt and coverage passed; no page errors or horizontal page overflow |
| axe A/AA/AAA-tagged checks | No violations on tested desktop coverage, mobile canvas and sign-in screens; not a full WCAG certification |
| Container | Built locally with TLS verification enabled; non-root startup, frontend and health passed |
| Packaged access control | Blueprint, source, snapshot and stream returned 401 without a token |
| Packaged source catalogue | 2,636 elements, 3,663 relationships; supplied source revision retained |
| Google/Firebase real engineer login | Not exercised; requires an authorised account and cloud credentials |
| Live GCP inventory/metrics/logs/traces | Not exercised; no usable ADC identity in this environment |
| Production deployment | Not performed |

Browser checks blocked external requests. Unit collector tests used explicit
fixtures; their activity was not presented as real production traffic. Offline
runtime screens showed all cloud collectors as disconnected. Source analysis
does not establish that any source revision is deployed.

Saved environment draft includes dependency installation, startup and readiness
instructions for this separate app. Draft saving does not apply or publish an
environment; it also does not deploy the application.

The console-only release helper stages committed source, checks its hashes before
Cloud Build tests, preserves existing Firebase domains and account roles, and
checks live collector outcomes before promoting updates. Unit tests exercise
missing/disabled users, role preservation, source filtering, incomplete cloud
reads and accidental public API exposure. Cloud execution remains unverified
until the authenticated Cloud Shell release is run.
