# Scrap collection, camera receipts and task management

Customer entry remains Market → Sell scrap. Collectors use their independently
approved scrap profile under the same Repaido sign-in. The task workspace shares
the actual `TaskStageTabs` component and agent workspace styles with service
agents. It opens one collection in a compact task dialog: Request, Travel,
Inspect, Quote and Payment. Requests remain a short list outside the dialog.

## Pickup evidence

New requests require a private Repaido camera receipt. The customer chooses the
pickup, opens the live camera, grants camera/location permissions and captures
the scrap. There is no gallery control in the pickup form. The server issues an
authenticated ten-minute ticket, checks JPEG metadata against that ticket,
requires a capture within three minutes and within 300 metres of the pickup,
and adds a Poppins watermark with the **server receipt time** and reference.
An hourly counter caps ticket creation at 20 per account without scanning old
captures. The same submitted image can retry without creating another object.

The request claims a ready photo belonging to that account and request ID,
within 30 minutes of receipt. Moving the pickup requires another photo. Ordinary
private document uploads and other accounts' photos cannot satisfy this check.
Customers can view their evidence; a candidate collector cannot see the photo
or exact pickup. The assigned collector gains access after acceptance. Camera
photos are unavailable after 30 days. Actual blob deletion needs the existing
bucket's retention/lifecycle configuration scoped to the `scrap-camera/` prefix;
do not apply that retention limit to identity or vehicle documents.

These controls bind an upload to its account, request and receipt. Device GPS
and EXIF remain device-reported inputs, not hardware camera attestation. They
cannot prove the contents of a photograph are genuine on a compromised client.
Inspection and customer acceptance remain separate controls.

## Collection and location

Acceptance → departure → arrival → inspected quote → customer agreement →
collector-reported payment → customer-confirmed receipt. New collections require
arrival within 300 metres before an evaluation. Existing collections retain
their earlier evaluation workflow and can use the new task interface.

Departing explicitly starts location sharing. Only the approved assigned
collector can publish GPS. Only that collector and the customer can read it.
Each reading must be fresh, and older packets cannot replace a newer sample.
GPS uses a separate record, so telemetry does not change the quote's version.
Readings older than 75 seconds disappear from the map. Sharing pauses on request
and is hidden on completion, cancellation, dispute or expired collector approval.
A paused sender cannot restore sharing by replaying an old packet.

The map reuses `JourneyMap`, Leaflet and the existing OpenStreetMap tiles.
There is no invented driving route or ETA and no additional route-provider
requirement. Directions open the same Google Maps link used by the agent app.
Web sharing works while the task is open and the page is in the foreground.
Collection and tracking reads refresh about every eight seconds while visible;
the submitting actor sees the server response immediately. This is bounded
foreground polling, not subsecond streaming or background APK tracking.
The existing Android customer/agent wrappers already permit video capture only
from their trusted `WEB_URL`; this feature does not change that trust boundary.

## Quotes and clear completion

Private scale photos are normalized and addressed by account/content hash.
Storage failures return a CORS-readable 503 instead of an unhandled exception.
A photo upload and server watermark run in the existing API's worker pool, so
a slow storage provider does not block its request event loop or tracking reads.
A lost object-upload acknowledgement is checked against stored content. Images
and successful upload references remain reusable on a quote retry. Gross/tare
weights are parsed into exact integer grams and prices into integer paise.
The server computes net weights and floors each line amount before summing.

Evaluations retain a command receipt. If the client loses the successful reply,
it reads the actual collection and reports completion only for that exact
command ID. A different quote or an unavailable lookup stays unconfirmed.
Pickup requests similarly reconcile using their private photo and matching
details. Automatic GPS, reads and camera tickets do not show save popups.
Intentional actions use specific messages such as “Weighing quote sent” and
“Receipt confirmed.” A collector's payment report is not bank verification.

## API surface

All routes use the main API under `/api/operations/local-business` through the
shared origin resolver, including on cPanel. Identity comes from the existing
verified bearer session; record IDs or browser role choices do not grant access.

| Route | Purpose |
| --- | --- |
| `POST /scrap/capture-sessions` | Issue a bounded, account/request-scoped camera ticket |
| `POST /scrap/capture-sessions/{id}/photo` | Validate, stamp and upload the captured JPEG |
| `POST /scrap` | Create a collection with required camera evidence |
| `GET /scrap`, `GET /scrap/{id}` | Read authorized collections and confirmations |
| `GET /scrap/{id}/pickup-photo` | Private pickup photo for customer/assigned collector |
| `POST /scrap/{id}/commands` | Versioned acceptance, travel, agreement, payment, cancellation or concern |
| `POST /scrap/{id}/evaluation` | Save the inspected, weighed quote with a command receipt |
| `GET /scrap/{id}/weighing-photo` | Private scale evidence |
| `GET /scrap/{id}/tracking` | Scoped, freshness-checked collector position |
| `POST /scrap/{id}/position`, `/position/start`, `/position/stop` | Assigned collector telemetry and sharing consent |

## Source and release checks

The Docker image explicitly includes `scrap_experience.py` and the licensed
Poppins font. Cloud Build's upload allowlist and source-inventory guard include
both the font and its OFL license. Existing private-bucket configuration and
the API service account's create/read permissions are still required. A code
change cannot grant those permissions; no new service, queue or deployment is
created during development. Storage logs contain error class and opaque receipt
ID, without photo bytes, GPS, phone numbers or credentials.

The next requested release must update API and web together. Publish the new
web bundle to **both cPanel and Firebase Hosting** if installed wrappers load
the Firebase site, so those clients can supply the newly required photo. Keep
the manual release gate and existing one/two release batches per day.

Validation:

```bash
cd backend
.venv/bin/python -m pytest -q test_scrap_experience.py test_local_business.py \
  test_business_profiles.py test_visits.py test_workspace.py test_build_source.py \
  test_cpanel_release.py test_selective_release.py
cd ../web
npm test
npm run build
```

Start Vite locally on port 5186, then run
`PLAYWRIGHT_MODULE=/path/to/playwright node tests/scrap.browser.mjs`.
This suite starts a real isolated SQLite API with filesystem-backed private
storage, captures a synthetic browser camera stream, injects a real storage
failure and loses a reply after an actual quote commit. It completes collection,
quote acceptance and receipt confirmation and checks responsive layout,
service-card motion/pause/reduced motion and enhanced contrast. It performs no
production writes or real payments. Preview files are outside the production
entry graph.
