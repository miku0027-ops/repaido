# Repaido Engineering

A separate, read-only architecture and observation console. Customer, business
and company-admin interfaces are unchanged. No deployment is triggered by these
files. Existing Repaido Firebase accounts sign in; the server requires the exact
custom claim `engineer: true`. An admin role alone does not grant access.

## Available

- HLD, LLD, application, infrastructure and combined diagrams; zoom, pan,
  minimap, draggable elements, saved local layouts, module/search/evidence filters.
- API paths (including literal router prefixes), individual Python functions,
  imports, literal collection references, inferred unit-of-work collections,
  Firebase Hosting rewrites, Terraform references and provider URL references.
- Node inspection with connections, function calls, source excerpts and matching
  activity. Source strings are redacted; snippets are limited to 240 lines.
- Read-only Cloud Asset Inventory, Monitoring, Logging and Trace collectors.
  Explicit cloud resource references become edges; matching service names link
  source to inventory without claiming a deployed-source revision match.
- Recorded trace parent-child relationships and a span waterfall. Request nodes
  pulse only for an observed request in the past 60 seconds. Source edges never
  animate as if they carried real traffic.
- Evidence and freshness labels, stale-data retention, coverage limits, JSON and
  editable draw.io exports. No sample data is shown as production observations.
- Poppins, keyboard navigation, focus indicators, reduced-motion support,
  responsive layouts and accessible text colours.

## Run locally

From the repository root, use the existing backend venv:

```bash
backend/.venv/bin/python -m pip install -r engineering/requirements.txt
pnpm --dir engineering/web install --frozen-lockfile --ignore-scripts
pnpm --dir engineering/web run build
ENGINEERING_LOCAL_PREVIEW=true backend/.venv/bin/uvicorn \
  engineering.server.app:app --host 127.0.0.1 --port 8010 --no-proxy-headers
```

The Python service serves the built frontend. For hot reload, run
`pnpm --dir engineering/web run dev` separately; Vite binds to 127.0.0.1:5190 and
proxies the engineering API to 8010. Restart the backend after source changes to
rebuild the catalogue. Local preview bypasses login only for loopback clients
using a loopback Host, with no forwarding header. It is rejected in Cloud Run,
App Engine and Cloud Functions. Never expose a preview or its Vite proxy publicly.

Useful checks:

```bash
curl -fsS http://127.0.0.1:8010/health
backend/.venv/bin/python -m pytest -q engineering/tests
pnpm --dir engineering/web run test
pnpm --dir engineering/web run build
```

`web/tests/browser-smoke.cjs` exercises the built UI using Playwright and axe,
with external requests blocked. Use the environment's installed Playwright via
`PLAYWRIGHT_MODULE` and Chromium via `BROWSER_EXECUTABLE`. The test requires the
loopback preview above with cloud collection off. It checks both desktop and
390-pixel layouts; automated axe results are not a complete WCAG certification.

## Connect real observations

Use an existing ADC / workload identity binding. Do not put service account keys
in frontend settings or send them in chat. The console does not need database
document access, secret-value access, Cloud Run write permissions or billing
administrator privileges.

| Setting | Purpose |
| --- | --- |
| `ENGINEERING_PROJECT=repaido` | GCP project and Firebase token audience |
| `ENGINEERING_CLOUD_ENABLED=true` | Explicitly enable cloud reads |
| `ENGINEERING_LOCAL_PREVIEW` | Omit in any shared or production environment |
| `ENGINEERING_SOURCE_REVISION` | 40-character source commit for packaged builds |

The requested release helper enables the Cloud Asset, Monitoring, Logging,
Cloud Trace and Identity Toolkit APIs and creates a dedicated console identity.
Its custom role contains only `cloudasset.assets.listResource`,
`monitoring.timeSeries.list`, `logging.logEntries.list`, `cloudtrace.traces.list`,
`cloudtrace.traces.get`, `firebaseauth.users.get` and `serviceusage.services.use`.
The last permission permits API quota consumption, not resource changes.
The OAuth scope is `cloud-platform`: Asset Inventory and Trace do not accept
`cloud-platform.read-only`. IAM restricts what the identity can do.
For tighter log access, use a dedicated log view and adapt `resourceNames` in
the collector before deployment. The web application cannot change IAM.

Provider endpoints: `cloudasset.googleapis.com`, `monitoring.googleapis.com`,
`logging.googleapis.com`, `cloudtrace.googleapis.com`, `identitytoolkit.googleapis.com`,
and Google's token/certificate endpoints. Workload Identity or attached service
identity is preferable to a downloaded service account key.

Use Firebase's existing Phone and Google sign-in providers. Add the console's
chosen HTTPS domain to Firebase Auth authorised domains before release. There is
no new account registry; engineers use their existing Repaido identity. Sign-in
is separate on a different origin. The public Firebase client configuration is
read from `web/src/firebase.ts`; no Firebase Admin credential is delivered to the
browser. Metadata and source APIs require a verified, nonrevoked Firebase token.

An authorised Firebase operator can preview an access change offline:

```bash
backend/.venv/bin/python engineering/manage_access.py grant --uid EXISTING_FIREBASE_UID
```

Only add `--apply` when the operator intends to grant that account access. To
remove access use `revoke`. The helper preserves other claims and revokes old
sessions. Token revocation also signs the account out of other Repaido apps.
The console never changes claims itself and has no cloud mutation endpoints.

## Cost and freshness

| Collector | Interval per process | Bound per collection |
| --- | --- | --- |
| Asset inventory | 300 seconds | 5 pages / 1,000 resources; explicit asset types |
| Service metrics | 60 seconds | 3 queries, 200 series each, 5-minute window |
| Logs | 15 seconds | Latest 100 entries in 15 minutes |
| Traces | 60 seconds | 20 traces, 200 spans per trace, 15-minute window |

Collectors run while viewers request data, plus one bounded release check on
each container start when `ENGINEERING_RELEASE_CHECK_UIDS` is configured.
That check uses the attached identity to verify all collectors and access to
the selected engineer accounts; public health exposes only pass/fail outcomes.
Cached results and failure
cooldowns are shared among viewers in the same process. Browser streams pause
when hidden, reconnect with backoff and refresh auth on reconnect. Streams last
at most about one minute between checks, with up to 20 per process. Provider
delays can extend a collection. Multi-instance deployments have independent
caches; start with one process and one instance limit for this internal console.
Do not run a per-browser cloud collector or turn on unrestricted request tracing.

Cloud Monitoring is sampled and delayed. Request counts cover only returned
series. P95 latency remains per minute and revision; never average percentiles
into a supposed global P95. Reaching any result limit is reported as partial.
An unavailable metric is unknown, not zero. Old data retains its original
successful collection timestamp after an error.

Logs are projected to safe metadata: method, known route template, status,
duration, timestamp, service/revision, and valid trace IDs. No raw URLs, customer
identifiers, query strings, text payloads, request/response bodies, headers or
environment values are returned. Access events record a hashed UID and operation,
not tokens or source content.

## Completeness boundaries

This version is a usable source blueprint and bounded observation console, not
a claim of complete live infrastructure discovery or an immediate replacement
for incident monitoring. In this development environment no usable GCP ADC was
available. Live IAM, provider reads and real Firebase engineer sign-in still need
verification in the connected environment; offline tests use explicit fixtures.

- Source is statically analysed, not executed. Python dynamic dispatch, dynamic
  router prefixes/collection names and generated client paths remain unknown.
  Unit-of-work receiver matching is explicitly inferred. Code-function calls are
  listed in the inspector; arbitrary dynamic call graphs are not invented.
- Terraform resources are desired/source configuration until cloud inventory
  confirms them. Network edges do not prove packet reachability. Firewall
  decisions, DNS resolution, external uptime and private-network connectivity
  require probes or VPC Flow Logs; these are not installed by this app.
- Runtime causality requires trace-context propagation and instrumented spans
  around HTTP, queue dispatch and database operations. Cloud Run request logs
  alone cannot show which function or query executed. Unsampled/absent spans
  remain absent; the console never infers causality from coincident timestamps.
- Instrumentation, alert rules, SLO evaluation, paging/on-call delivery,
  long-term retention, cost attribution and incident workflows are future work.
  Keep current production alerts until these are implemented and exercised.
- Not all GCP products are covered. The inventory asset-type allowlist is in
  `server/cloud.py`. Other projects, third-party internals and native Android
  call graphs require additional collectors/instrumentation.
- The canvas renders at most 180 matching elements at once. Filter by module,
  search or focus a node to inspect the remaining catalogue. Exports retain the
  full blueprint (JSON) or currently arranged diagram (draw.io).

## Prepare a requested release

Keep the console on a separate HTTPS origin and Cloud Run service, with a
dedicated read-only identity. Do not add it to the customer app's public API
rewrite. `engineering/Dockerfile` builds the frontend and serves it from FastAPI;
its specific `.dockerignore` excludes credentials, databases and dependencies.
Build context is the repository root. Pass `--build-arg SOURCE_REVISION=<commit>`.
Do not set local preview in the runtime. The app rejects non-engineer API access
even if transport is reachable, and sends private/no-store and framing headers.

The existing production pipeline intentionally does not deploy this console.
After an explicit release request, run this from an authenticated Google Cloud
Shell checkout of the reviewed commit:

```bash
python3 engineering/release.py --release FULL_COMMIT_SHA \
  --engineer-email EXISTING_APPROVED_EMAIL \
  --engineer-email ANOTHER_APPROVED_EMAIL
```

Without `--release`, the helper only prints an offline plan. It resolves all
emails to existing Firebase accounts before making changes; it never creates
users. The operator needs service enablement, custom IAM role and binding
administration, Firebase Auth administration, Cloud Run deployment, permission
to attach the dedicated service identity, and Cloud Build submission/read access.
The existing build identity builds and pushes the image; it receives no new
project-wide role or token-creation permission.

The helper stages reviewed Git files instead of using the customer pipeline's
upload filter, verifies hashes in Cloud Build, runs the console tests, and
submits one build. It deploys the resulting image digest to `repaido-engineering`
with zero minimum instances, at most one instance per revision, request-based
CPU, 512 MiB memory and a dedicated read-only identity. A rolling release can
temporarily have both the old and candidate revision running.

It preserves existing Firebase authorised domains and other account claims.
Both the legacy and numbered service origins reported by Cloud Run are added
to Firebase and verified, so either supported console address can sign in.
New engineering grants revoke existing sessions, including customer-app sessions
for those accounts. Repeating the release does not revoke sessions again when
the correct engineering claim already exists.

Before promoting an update, it checks the exact source/build IDs, all four live
collectors, runtime access to the selected accounts, the built sign-in page,
security headers, and rejection of anonymous/malformed-token API requests.
An existing service keeps its old traffic on a failed candidate check. On the
first release there is no previous version; the new sign-in page is reachable
during verification, but every metadata endpoint still requires engineer auth.
After success, complete one interactive Google/phone sign-in on the printed
console URL. Do not claim browser sign-in was tested by these noninteractive checks.

No customer service, Firebase Hosting deployment, production build trigger,
database record or secret value is changed by this release helper.
