# Cloud Shell activation from the serving backend image

`activate.py` prepares and verifies the existing bike dispatch runtime. It does
not build an image, publish the website, approve a rider, change a fare, open
bookings, or manufacture salary funding. The committed Terraform remains
disabled until the explicit `apply-infra` phase runs.

Run this only from the reviewed release checkout in Google Cloud Shell, after
the current read-only launch inventory has been checked. A failed or incomplete
inventory is not evidence that a resource is absent. No cloud changes have been
performed by the offline checks for this helper.

Publish and verify the final reviewed backend release first. The helper reuses
the image already serving at preparation time; it cannot include later source
fixes or frontend changes. If another backend release occurs during activation,
prepare a new plan from its verified serving revision rather than reusing an
older release manifest.

## Plan and ownership

The initial steady capacity is **two private e2-small workers**, one in each of
`us-central1-a` and `us-central1-b`. The helper defaults to a maximum of two;
`--maximum-workers` may explicitly raise it to 16 after capacity and spend review.
A rolling replacement may temporarily add two surge workers. Pub/Sub, workers,
disks, state storage, secrets, logging and Monitoring can incur charges. This is
a bounded starting configuration, not a throughput or availability guarantee.

The workers share one ordered subscription. Different rider keys can execute
in parallel; a rider's reservation sequence stays serial. Flow control of 32
messages per worker is not a capacity of 32 simultaneous rides. Native Firestore
transactions enforce reservation, free-ride quota and replay protection before
delivery is acknowledged. Retained events and the outbox must survive rollback.

Matching existing dedicated resources are imported into the protected Terraform
state instead of recreated. An incompatible subscription, mixed Cloud Run
traffic, subnet overlap, mutable image, unpinned quota key, destructive plan or
unrelated API change stops the helper. A resource already owned by another
Terraform state must be transferred deliberately before running `adopt`.

Use an authorized Cloud Shell OAuth account and Terraform ADC, without service
account key files. The operator needs permission to inventory and provision the
dedicated Compute, Pub/Sub, Monitoring and service-account resources; enable
required APIs; manage their scoped IAM grants; create or use the protected state
bucket and quota secret; and deploy/tag the existing Cloud Run API. The helper
does not grant the operator roles or change billing. Keep these permissions
with the designated release operator rather than adding Owner grants.

## 1. Verify tools and inventory

For the reviewed Balasore pilot, a single preparation wrapper is available after
the website and both APIs have been verified against their successful build:

```bash
bash scripts/prepare-bike-runtime-plan.sh VERIFIED_SERVING_BUILD_ID
```

This explicit setup command fills only a missing editable Balasore centre
(`21.4934, 86.9135`) and an absent disabled ₹7,000 salary template. The centre
remains pending company review; funding stays zero/unacknowledged and the roster
stays empty. Existing locations, payroll, fares and agreements are preserved.
The default writes use document-update preconditions and an atomic maintenance
audit; live booking policies are rejected.

The wrapper installs checksum-pinned official Terraform 1.16.6 privately in its
printed run directory, bypassing Cloud Shell's installation shim. It then runs
the explicit prerequisite bootstrap and prepares a saved two-worker plan using
the project-owned state-bucket name
`repaido-bike-runtime-tfstate-133610574058`. Its availability/ownership is checked,
not assumed. It does not apply the worker plan, change API traffic, or open
bookings. Prerequisite APIs, the protected bucket and an absent quota secret may
be created; retain the printed records if a later phase stops. Inspect any error
before retrying, particularly an existing unbound secret or an uncertain default
commit. Never remove a secret to get past a setup check.

Bucket ownership is checked against `projectNumber` from the canonical Storage
JSON API, because Cloud Shell's transformed bucket display can omit that field.
A bucket name or the selected CLI project does not prove ownership. The
bootstrap's optional `--record-file` preserves metadata and the numeric key
reference before later checks, including partial setup failures.

After inspecting an interrupted preparation and its numeric secret-version
metadata, reuse its verified Terraform and run directory with:

```bash
bash scripts/resume-bike-runtime-plan.sh EXISTING_RUN_DIRECTORY \
  VERIFIED_SERVING_BUILD_ID REVIEWED_NUMERIC_SECRET_VERSION
```

This continuation preserves saved launch defaults and refuses to overwrite an
existing release/plan directory. It repeats prerequisite verification with the
reviewed existing key, then prepares a fresh plan; it never creates a replacement
key simply because an earlier bootstrap did not finish printing its receipt.

From the release repository root, use official Terraform 1.7+ compatible with
the committed provider lock. Confirm the selected account belongs to this
release operator. Do not paste OAuth output or secret bytes into chat.

```bash
gcloud auth list --filter=status:ACTIVE --format='value(account)'
gcloud config set project repaido
terraform version
python3 scripts/check-bike-launch.py
python3 infra/bike-runtime/activate.py inventory
```

The helper inventories the actual serving revision and pinned image, resource
metadata, ordered subscription, regional quotas, numeric quota-key reference,
and both work services. It omits API environment values and secret contents.
Disabled prerequisite APIs can make this full inventory stop; establish the
serving revision with the launch checker before the next explicit setup phase.
If Terraform ADC is unavailable, use the account's normal OAuth ADC login flow;
do not create a long-lived service account key as a workaround.

## 2. Prepare prerequisites

Choose a globally unique, project-owned `repaido-*` bucket name for private
Terraform state. This explicit phase enables prerequisite APIs, creates the
bucket if missing, enforces versioning and verifies its project ownership. It
also creates the quota identity secret **only when no existing API binding or
secret requires preservation**. Generated bytes travel through stdin to Secret
Manager and never enter command arguments, release records or output.

```bash
REPAIDO_BIKE_STATE_BUCKET=repaido-bike-runtime-tfstate
python3 infra/bike-runtime/activate.py bootstrap \
  --state-bucket "$REPAIDO_BIKE_STATE_BUCKET"
```

The bucket above is a naming example; availability has not been verified.
Record the printed **numeric secret version resource**, not its value. If the
secret already exists without an API binding, the helper stops instead of
rotating it. Review its version metadata, identify the established key version,
and rerun `bootstrap --quota-secret-version` with that full resource. The same
option resumes prerequisite setup after a partial earlier run. Never select
`latest`, replace a working key, or choose a new version just to clear an error:
changing the key changes the identity used for free-ride quota enforcement.

## 3. Save and review the exact infrastructure plan

Set `REPAIDO_BIKE_QUOTA_VERSION` to the verified resource printed above, such as
`projects/repaido/secrets/<existing-secret>/versions/<numeric-version>`. The
following reads that reference only; it does not access secret bytes.

```bash
REPAIDO_BIKE_RUN=$(mktemp -d "$HOME/repaido-bike-activation.XXXXXX")
python3 infra/bike-runtime/activate.py prepare \
  --state-bucket "$REPAIDO_BIKE_STATE_BUCKET" \
  --quota-secret-version "$REPAIDO_BIKE_QUOTA_VERSION" \
  --maximum-workers 2 \
  --directory "$REPAIDO_BIKE_RUN/release"
```

An optional `--alert-email` sets a reviewed Monitoring recipient. Without it,
the policy sends no new email; any existing alert notification-channel references
are preserved automatically and remain owned outside this module. Existing matching
resources produce an adoption list first. Review their exact IDs and existing
ownership, then run:

```bash
python3 infra/bike-runtime/activate.py adopt --directory "$REPAIDO_BIKE_RUN/release"
```

`adopt` imports state and saves a plan; it does not recreate cloud resources.
Read the complete `plan.txt` in the release directory, including IAM grants,
network, image digest, numeric secret version and capacity. `plan-summary.json`
is only a navigation aid. The binary saved plan is hash-bound to the release
manifest and checked for forbidden deletion/replacement. Keep this directory
private; remote state has locking, uniform access, public access prevention and
versioning. Do not commit state, plans, ADC files or generated release records.

## 4. Provision workers, then create a zero-traffic API candidate

After the concrete plan is reviewed, these are separate explicit cloud changes:

```bash
python3 infra/bike-runtime/activate.py apply-infra --directory "$REPAIDO_BIKE_RUN/release"
python3 infra/bike-runtime/activate.py candidate --directory "$REPAIDO_BIKE_RUN/release"
```

The candidate uses the exact digest recorded from the serving API. It updates
only the five dispatch environment fields and the API's numeric quota-secret
binding, adds secret access for the existing API identity, and receives zero
production traffic. It preserves unrelated variables, secret references,
identity, resources, networking and the two work services. It verifies the
unchanged build ID, dispatch heartbeat, routing configuration and quota-key
readiness against the tagged candidate URL.

Cloud initialization and IAM propagation may take time. If verification stops,
leave production traffic on its recorded revision and rerun the read-only
check after resolving the reported problem:

```bash
python3 infra/bike-runtime/activate.py verify --directory "$REPAIDO_BIKE_RUN/release"
```

If the candidate update timed out or Cloud Shell disconnected before writing
its result, do not submit another revision blindly. Recover the recorded tag
using reads only:

```bash
python3 infra/bike-runtime/activate.py recover-candidate --directory "$REPAIDO_BIKE_RUN/release"
```

Recovery requires the original production revision to retain 100% traffic and
the recorded tag to identify a matching zero-traffic candidate. A missing tag
or ownership mismatch needs inspection of Cloud Run before another deployment.

## 5. Promote configuration, then perform the real launch checks

```bash
python3 infra/bike-runtime/activate.py promote --directory "$REPAIDO_BIKE_RUN/release"
python3 scripts/check-bike-launch.py
```

Promotion rechecks the unchanged production baseline, both work services,
healthy private workers across both zones, actual worker image/key identity,
candidate settings and live readiness. Only then does it assign 100% API
traffic to the candidate. The verification receipt records `bookings_available`
honestly; infrastructure readiness alone does not open the service.

The two-zone check proves MIG process liveness after initial readiness. The API
dispatch check proves at least one current matching connected consumer; it does
not prove that both zones currently have broker-connected workers. Inspect the
admin's healthy/degraded worker counts during the live resilience checks.

Promotion also verifies the exact reconciled Cloud Run revision traffic, since
the old and new revisions intentionally have the same build ID. If the traffic
update or receipt write was interrupted, use the read-only recovery command:

```bash
python3 infra/bike-runtime/activate.py recover-promotion --directory "$REPAIDO_BIKE_RUN/release"
```

Recovery writes a receipt only when the recorded candidate actually serves
100% of production traffic and passes the same runtime checks. It does not send
another traffic update or override a newer pending API release.

The company admin must still configure the real reviewed service area, customer
fares and terms, approve properly documented riders/vehicles, establish the
payroll and actual funds for at least one real approved salaried rider (up to
the three-rider launch roster), and enable paid/promotion
policy. Follow [the bike launch checklist](../../docs/BIKE_LAUNCH.md), including
real normal and shared-bike booking, cancellation, pickup, arrival, completion,
cash settlement and free-quota checks. Do not enable the service using invented
accounts, balances, location evidence or consent. Observe real queue age, retry
rates, errors and spend before expanding geography or worker capacity.

## Recovery

`manifest.json` preserves the previous production revision and image;
`promoted.json` records the rollback revision. To restore the prior API revision,
use that **recorded** name with `gcloud run services update-traffic repaido-api
--region=us-central1 --project=repaido --to-revisions=<recorded-revision>=100`.
Preserve the ordered subscription, outbox, stable quota key and Terraform state.
Pause new bookings through the existing admin policy if needed. Do not destroy
the worker module to roll back a release with active rides.

Offline tests cover guardrails, provider-response shapes and mocked Terraform
configuration. They do not prove real IAM, private image pulls, quota headroom,
worker failover, customer billing or live rider behavior. The explicit Cloud
Shell and end-to-end checks above provide that remaining evidence.
