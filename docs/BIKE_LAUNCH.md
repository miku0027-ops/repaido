# Balasore bike launch: configuration and operator records

Deploying the application does not activate company bike bookings. The API,
continuous dispatch worker, salary funding, approved riders/bikes and operating
policy must agree before the existing server gate opens. Do not change those
gates or use local direct dispatch to make an unavailable service appear live.

The agreed pilot remains ₹8 base plus ₹5/km, no per-minute charge, a maximum
4 km road trip and 4 km pickup search. Eligible free road trips cover up to 2 km,
three per ISO week in India time, with 36 hours between free uses during six
calendar months from the locked launch date. Up to three company riders earn
₹7,000 per month each. Independent payout amounts remain unset and that plan
must stay disabled. These figures do not need another pricing decision.

## 1. Collect a read-only inventory in Cloud Shell

From the checkout containing the reviewed support script:

```bash
python3 scripts/check-bike-launch.py
```

The standard-library helper reads only projected GCP resource metadata and the
public bike policy. It creates nothing, grants no IAM, reads no secret payload,
starts no worker, changes no policy, and never prints raw environment values,
phones, rider records or stop coordinates. Its JSON can be shared for review.
`not_found`, `permission_denied` and authentication errors are distinct; a failed
metadata read does not establish that a resource is missing. An absent mode flag
uses the source's Pub/Sub default and is reported separately from its presence.
The public policy is the effective readiness result. No migration or app build
is needed merely to run this probe.

An `incomplete_response` means the Cloud Run container configuration could not
be inspected. It does not establish that Firestore, dispatch settings or a
secret are missing. The probe reads the complete container metadata and
sanitizes its output; raw environment values are never included. If the public
policy request fails, booking availability is reported as unknown (`null`),
rather than claiming the server reported a paused service.

The service inventory describes the latest service template. Before making any
configuration change, confirm which revision receives traffic. A split/canary
needs review of every serving writer, rather than assuming latest means live.
After locating the serving revision, obtain its existing immutable image:

```bash
gcloud run services describe repaido-api --project=repaido --region=us-central1 \
  --format='yaml(status.traffic,status.latestReadyRevisionName)'
gcloud run revisions describe VERIFIED_SERVING_REVISION \
  --project=repaido --region=us-central1 --format='value(status.imageDigest)'
```

Keep credentials in Cloud Shell/secure environment settings. A rejected bound
access token is not repaired by copying it into a command or chat. Cloud Shell
uses its signed-in `gcloud` identity; the worker uses runtime ADC.

## 2. Review the actual continuous runtime before provisioning

If a compatible continuous worker, topic or subscription exists, inspect its
owner and adopt it through reviewed imports where appropriate. Do not recreate,
purge or replace a live subscription. Reuse a suitable existing continuously
running runtime where possible; the ordinary API request container and minute
notification Scheduler are not continuous bike consumers.

If no suitable runtime exists, the prepared configuration is
`infra/bike-runtime`. It remains disabled until a concrete plan is reviewed:

| Resource | Prepared plan to review |
| --- | --- |
| Regional managed workers | Two `e2-small` minimum across `us-central1-a` and `us-central1-b`; reviewed ceiling up to the prepared default of 16 |
| Disk | One 20 GB `pd-balanced` boot disk per worker |
| Rolling replacement | Up to two temporary surge workers above the steady-state ceiling |
| Queue | One region-restricted topic, one ordered pull subscription, seven-day retention, no silent dead-letter discard |
| Network | Private-only VPC/subnet `10.73.0.0/24`, Private Google Access, health-probe firewall on port 9118 |
| Recovery | Supervised process restart, managed-group liveness recovery and bounded Pub/Sub reconnection |
| Identity | Dedicated worker account; resource-scoped publish, subscribe/metadata, image pull and quota-secret access |
| Shared project access | Worker `datastore.user` and `logging.logWriter`; existing Firestore, not a new database |
| Alerts | Oldest unacknowledged event alert; configure a real operational recipient |

Two workers, disks, Pub/Sub and logs incur costs even before customer demand.
Review current prices, quotas, the steady-state ceiling, surge capacity, address
range and incident ownership before applying anything. This runbook does not
approve or automatically create paid resources. Protect Terraform state with a
reviewed remote backend, restricted IAM, locking and versioning; the source
does not create a state bucket. Keep local state and `.tfvars` out of Git.

Use the already deployed compatible backend image **by digest**, rather than
submitting another full application build. The worker image must contain the
current dispatch, funding and earnings code. Never downgrade a worker to code
that cannot interpret existing reservations.

## 3. Bind the matching API and worker configuration

After resource ownership, cost and an exact runtime plan are reviewed, configure
both API and worker to the same project, topic, subscription and regional
endpoint specified in [the dispatch contract](BIKE_DISPATCH.md#runtime-contract).
The actual subscription must have ordering enabled. New API environment values
are a configuration-only Cloud Run revision using the same image; stage it with
no traffic, verify it and preserve existing secrets, IAM, ingress and routes.
No source rebuild, Firebase Hosting release or cPanel republish is necessary for
runtime-only settings.

Use one existing stable quota key through a pinned **numeric** Secret Manager
version. If no campaign key exists, a separately reviewed secret can be generated
without printing its contents. Do not rotate a live campaign key or use `latest`:
quota identities must stay stable. API and worker must load the same value.
Grant the API runtime access only to that secret. It does not need Pub/Sub
publisher or subscriber permissions; it writes the native outbox. The dedicated
worker needs publish on its topic, consume and metadata read on its subscription,
pull on its image repository and access to the one quota secret, alongside the
existing shared Firestore/log permissions. Do not add project-wide Pub/Sub Admin.

Set `REPAIDO_BIKE_DISPATCH_WORKER_ENABLED=true` only in the continuous worker.
Do not change existing `repaido-work-updates`, booking reminders, journey location
delivery or notification schedules. The worker must report healthy membership
and actual Pub/Sub permissions/ordering before `dispatch_ready` becomes true.
A successful container start alone is insufficient.

## 4. Complete real company and rider records

Riders and bikes still need to register and receive real company document
approval. Do not insert fixture rider IDs, pretend documents, funding evidence
or salary transfers to satisfy a readiness check.

Use Company → Transport → Bikes after onboarding:

1. Select the actual approved Balasore rider IDs and their approved bikes.
   For three riders, acknowledge current-month salary coverage of at least
   ₹21,000, with a real reference and evidence. Earlier earned obligations remain
   payable after replacement/offboarding and can raise the required coverage.
2. Review the operating centre and radius using the actual Balasore service
   area. A default map point is not an approved operating boundary.
3. Keep the agreed ₹8/₹5 fare and 4 km/2 km limits. Review the applicable GST rate,
   cash collection and cancellation terms. Do not silently assume a tax rate.
4. Review campaign funding/terms and choose the actual fixed launch start. The
   first saved date locks the six-month campaign window; do not restart it.
   A planning allocation is not an enforced spending cap or a bank deposit.
5. Confirm server readiness and activate new bookings through the normal policy
   action. It rechecks dispatch, routes, geography, fare and staffing/funding.

Riders then choose their approved bike, grant precise GPS and go online in the
rider app. An enabled policy with no online eligible rider correctly returns no
match; it does not justify a fake availability indicator.

### Prepare the designated ground-test account

Use the account holder's email and the confirmed registration exactly as
supplied. The helper does not replace letters with similar-looking digits.
Pass these identifiers at runtime; keep personal account details out of source
files and commits.

```bash
python3 scripts/prepare-bike-pilot-rider.py \
  --email "$REPAIDO_PILOT_EMAIL" --registration "$REPAIDO_PILOT_REGISTRATION" \
  --mode inventory
```

The read-only result checks both Firebase email and Repaido's saved account
email, flags ambiguous identities, and reports actual profile, bike and
document-metadata gaps. It omits names, phone numbers, addresses and document
paths. A different existing owner is never reassigned automatically.

When account creation is explicitly requested, add `--create-account-if-missing`
instead of `--mode inventory`. This reuses an existing UID or creates the
specified unverified email account. It sends no email and does not assign a
password, verified mobile, business approval or salary funding. An uncertain
write outcome requires a read-only inventory before retrying.

The account holder signs in at `/worker?mode=cab_owner&tab=fleet` and links
their real mobile through the existing SMS flow, retaining the same UID.
They complete their owner-rider application and add the actual one-passenger
bike with its supporting documents. Company review sets the earliest verified
document expiry and its real review reference. A separate driver can instead
use `/worker?mode=driver&tab=vehicles` and accept the owner's assignment.

One approved, funded salaried rider is enough for the initial ground test;
three is the roster limit. Configure the actual current-month funding and
launch policy through company admin before opening normal bookings.

When the operator has explicitly selected an existing approved mobile account
and bike, check those exact records without resolving or merging email accounts:

```bash
python3 scripts/check-bike-pilot-readiness.py \
  --driver-id "$REPAIDO_PILOT_DRIVER_ID" \
  --vehicle-id "$REPAIDO_PILOT_VEHICLE_ID"
```

This helper uses masked, read-only document requests. It identifies missing
saved policy fields, the selected bike's actual operator, current approvals,
roster membership and current-month salary funding metadata. It omits contact
details, plates, coordinates, documents and funding evidence. It never calls
payroll administration endpoints that can accrue obligations. Metadata checks
do not establish a bank deposit or replace the serving API's booking readiness;
read failures remain distinct from absent records.

Shared bikes use the existing scheduled shared-ride model: an approved
owner/assigned rider publishes one passenger seat and a per-seat fare. Their
acceptance, private customer pickup code, precise pickup/drop-off checks and
payment acknowledgements are separate from normal on-demand quotes and free
ride eligibility. Both models reserve the physical bike/rider to prevent
overlapping assignments.

## 5. Verify a controlled launch and keep recovery intact

Confirm actual two-wheeler routing and Firebase phone verification/SMS on real
devices. Check public `bookings_available`, company dispatch health and both
worker-zone memberships. With approved test participants, exercise one reviewed
quote, acceptance, pickup GPS/code, destination GPS, customer completion and
paid/free receipt flow. Verify one-next-slot behavior, replay/reconnect and a
worker replacement against controlled test records before increasing demand.
Do not manually send notifications to ordinary users as a deployment test.

During an incident pause **new** bookings through policy, retain compatible
consumers, and preserve the subscription, outbox, quotas, active trips and money
ledgers. Do not destroy the infrastructure or purge ordered events as a rollback.
The normal minute worker and location/notification delivery must keep running.
