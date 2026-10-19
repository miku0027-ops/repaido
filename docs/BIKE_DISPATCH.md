# Ordered bike dispatch

The selected production transport is **Google Cloud Pub/Sub**. Nothing in this
change creates a topic, subscription, runtime, service account, API activation or
IAM grant. New bike bookings stay unavailable until an operator activates the
bike policy and the matching continuous worker is healthy. Existing rides remain
readable when dispatch is unavailable.

## Runtime contract

The backend image includes `h3==4.3.1` and `google-cloud-pubsub==2.43.0`.
Start the separate supervised worker with:

```sh
python -m bike_dispatch_worker
```

Configure these values on the API and worker so readiness refers to the same
transport and resources:

```text
REPAIDO_STORAGE=firestore
REPAIDO_BIKE_DISPATCH_MODE=pubsub
REPAIDO_BIKE_PUBSUB_TOPIC=projects/repaido/topics/repaido-bike-dispatch-v1
REPAIDO_BIKE_PUBSUB_SUBSCRIPTION=projects/repaido/subscriptions/repaido-bike-dispatch-worker-v1
REPAIDO_BIKE_PUBSUB_REGION=us-central1
```

Free promotion additionally requires the same stable, server-only
`REPAIDO_BIKE_PROMO_QUOTA_SECRET` (at least 32 random bytes) on API and worker.
Bind it using the reviewed secret mechanism. Do not print it, expose it through
frontend configuration or rotate it during the campaign without migrating the
existing mobile quota identities. See [the launch contract](BIKE_RIDES.md).

Set `REPAIDO_BIKE_DISPATCH_WORKER_ENABLED=true` on the dedicated worker only.
Use the runtime service account's Application Default Credentials; do not put
access tokens or private keys in these variables. The worker needs continuous
CPU and graceful shutdown support. A Cloud Run worker pool, a supervised process
on an existing VM, or a reviewed continuously running container can provide that
runtime. The normal API container, request-only CPU, a scheduled Cloud Run job,
and the existing minute notification scheduler do not provide this lifecycle.
No new always-on infrastructure is enabled by the source change.

Initialize local indexes with `bike_dispatch.initialize(core)` **after**
`core.operations_store.init()` in application startup. The worker does this in
its own entry point. Module import and route installation must not initialize
the database.

## Provisioning commands for a requested release

Review the names, service account and regional placement before running these
commands. They are an operator runbook, not actions already performed. If a
resource exists, inspect it instead of recreating it. These commands do not
deploy or activate a worker or the bike launch policy.

```bash
gcloud services enable pubsub.googleapis.com --project=repaido

gcloud pubsub topics create repaido-bike-dispatch-v1 \
  --project=repaido --message-storage-policy-allowed-regions=us-central1

gcloud pubsub subscriptions create repaido-bike-dispatch-worker-v1 \
  --project=repaido --topic=repaido-bike-dispatch-v1 \
  --enable-message-ordering --ack-deadline=60 \
  --min-retry-delay=1s --max-retry-delay=30s \
  --message-retention-duration=7d --expiration-period=never

# Set this to the reviewed dedicated worker account before the IAM commands.
: "${TASK_BIKE_WORKER_SERVICE_ACCOUNT:?Set the reviewed worker service-account email}"

gcloud pubsub topics add-iam-policy-binding repaido-bike-dispatch-v1 \
  --project=repaido \
  --member="serviceAccount:$TASK_BIKE_WORKER_SERVICE_ACCOUNT" \
  --role=roles/pubsub.publisher

gcloud pubsub subscriptions add-iam-policy-binding repaido-bike-dispatch-worker-v1 \
  --project=repaido \
  --member="serviceAccount:$TASK_BIKE_WORKER_SERVICE_ACCOUNT" \
  --role=roles/pubsub.subscriber

gcloud pubsub subscriptions add-iam-policy-binding repaido-bike-dispatch-worker-v1 \
  --project=repaido \
  --member="serviceAccount:$TASK_BIKE_WORKER_SERVICE_ACCOUNT" \
  --role=roles/pubsub.viewer

gcloud pubsub subscriptions describe repaido-bike-dispatch-worker-v1 \
  --project=repaido \
  --format='yaml(name,topic,enableMessageOrdering,ackDeadlineSeconds,retryPolicy)'
```

The scoped viewer grant supplies subscription metadata access used by the
readiness check. A reviewed custom role containing only
`pubsub.subscriptions.get` can replace it. Publishing and consumption are scoped
to the named resources. The worker also needs the existing reviewed Firestore
access used by the backend; this runbook grants no project-wide role. The API
only writes the native transaction/outbox and reads worker health, so it does
not need Pub/Sub publisher/subscriber grants.

All publishers use the same `us-central1-pubsub.googleapis.com:443` endpoint.
The actual `enableMessageOrdering` subscription property is verified at runtime;
an environment flag alone does not establish ordering. Readiness also tests the
worker's publish/consume permissions. Topic/subscription names and credentials
never appear in public health responses.

## Transaction and retry behavior

1. A booking API transaction records a `dispatch_pending` native intent and a
   metadata-only outbox event. It allocates a monotonically increasing sequence
   in the rider's shared stream. Client timestamps and page dwell time do not
   grant priority.
2. A bounded relay leases rider streams and publishes each next event using
   `ordering_key=rider_id`. The database marks an outbox event published only
   after Pub/Sub acknowledges publication. Failed or ambiguous publication is
   retried from the durable record before a later sequence is sent.
3. The subscriber verifies the ordering key and the committed outbox envelope.
   In one shared `Store` transaction it checks sequence/deduplication and calls
   the actual native reservation engine. That engine revalidates the quote,
   policy, rider, reciprocal booking conflicts, free-ride quota, current salary
   funding, launch eligibility and physical current/next slot. Losing availability
   is a committed business result, not a silently upgraded paid ride.
4. The subscriber acknowledges only after the database commit. Unexpected
   failure sends a negative acknowledgment. Redelivery after a lost acknowledgment
   returns the recorded result without repeating reservation or quota changes.

Pub/Sub ordering does not make two storage systems exactly-once and does not
replace the transactional quota/slot locks. Envelopes contain event and native
record identifiers and versions, not passenger GPS, contacts, addresses or OTPs.
Do not purge an unpublished outbox or a pending ordered event. A poison event
must be investigated and repaired against its native record; moving it to a
dead-letter topic or acknowledging it without a matching native outcome would
break the sequence. The source does not silently discard poison events.

The relay polls every 0.5 seconds, with bounded per-pass work and a persisted
round-robin cursor to avoid starving later rider streams. Subscription flow
control limits outstanding messages to 32 and outstanding bytes to 1 MiB.
Provider/database retries and real traffic affect actual latency; these are not
a guaranteed dispatch SLA.

## Health and rollout checks

The worker writes a heartbeat every 20 seconds. API readiness requires a matching
transport/resource fingerprint, a heartbeat no older than 60 seconds and actual
healthy relay/subscriber status. A hostname or a historic Kafka heartbeat cannot
enable Pub/Sub bookings. Health exposes mode, configured/ready status, heartbeat
age and available queue measurements only. Outbox backlog is marked as a lower
bound if its bounded sample is full. Consumer lag remains `null` until measured;
it is not presented as zero.

Before enabling a launch policy, verify an actual broker round trip with the
deployed worker, duplicate delivery, worker restart between database commit and
acknowledgment, a busy rider's next-slot reservation, quota races, reciprocal
cab/shared conflicts, a disconnected subscriber and safe recovery. Those live
infrastructure checks have **not** been performed by the local unit tests.

## H3 discovery and ETA

Rider references occupy real resolution-6 H3 cells, including a busy rider's
upcoming destination cell. Pickup search reads a bounded three-step neighborhood
(at most 37 cells), then native records enforce the real 4 km pickup distance and
fresh GPS. Each populated cell returns at most 24 references, so a search examines
at most 888 candidates. Empty cells need only the batched version read. This is a
bounded local candidate set, not a claim to exhaust every rider in a saturated
cell or find a mathematically global optimum.

The 15-second in-process candidate cache holds IDs and coarse cell/version keys;
it holds no customer precise coordinates. Native vehicle, profile and slot data
are reread before quoting/reserving. Uncommitted projections never enter the
shared cache. Current completion time, pickup ETA and deadhead distance drive an
explainable score; at most five candidates are reranked with actual Google
`TWO_WHEELER` road durations in parallel. Provider failure leaves the discovery
ETA labeled as a distance estimate. Booking separately requires the confirmed
customer journey route. The later 8 km trip option does not expand the initial
4 km pickup search. Routing does not claim to reproduce a competitor's private
dispatch model or guarantee profitability.

## Development and optional Kafka compatibility

The deterministic local adapter requires all three settings:

```text
REPAIDO_ENV=test
REPAIDO_BIKE_DISPATCH_MODE=direct
REPAIDO_BIKE_DIRECT_DEV_ENABLED=true
```

It refuses Cloud Run runtime markers and exercises the same reservation callback
through `drain_direct`. It is never a production fallback when Pub/Sub is down.
Pub/Sub emulator environment fallback is explicitly rejected.

Kafka remains an optional, explicitly selected compatibility adapter. The normal
image does **not** contain its client. A separately reviewed optional build must
install `backend/requirements-kafka.txt`, then configure mode `kafka`, TLS
bootstrap servers and secure credentials before using that adapter. This is not
the selected launch transport and no Kafka cluster was provisioned or tested.
