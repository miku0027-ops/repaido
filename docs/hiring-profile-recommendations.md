# Hiring profile recommendations

The hiring profile flow scores bounded numeric evidence with a deterministic
function in `backend/hire_ranking.py`. It runs in the calling API by default.
An optional private service provides the same calculation when independent
isolation is useful. This is a small calculation: inline execution usually
avoids more work and cost than making another authenticated network request.
The separate service is an isolation option, with no established savings claim.

Existing profile ownership, visibility, availability, verified reviews and hiring
actions remain the responsibility of the calling API. Ranking is evidence-based
ordering, not a prediction, invented review, match percentage or authorization
decision. This feature does not assume that moving other backend modules into
services will reduce cost.

Profile next actions use currently approved Home services or existing catalogue
packages for the professional's listed categories. Verified category reviews
use confidence `n/(n+5)`; completed category work and matching package history
break ties. Missing reviews remain missing, and bounded work evidence is labeled
as a sample. The next action does not forecast demand, price or availability.

Public details read at most 81 work records and use 80 for displayed evidence;
an extra record establishes whether the evidence is incomplete. Current profile
approval, approved Home services and catalogue packages are checked on each
read. No recommendation snapshot survives an approval or catalogue change in
the API. Work and review lists are ordered by completion time within that
document-key window, not claimed to be the professional's latest lifetime work.
When native completion/review counters are coherent and at least as large as
observed evidence, overall counts and rating retain those authoritative totals
and `totals_scope.complete` is true. Category records, distribution, performance
and visible history keep their separate `evidence_scope`; otherwise the overall
counts are explicitly a bounded sample too.

## Data and execution boundaries

Each request contains 1–12 candidates with seven bounded numeric or boolean
evidence fields per candidate.
The API keeps candidate identity and uses result positions to associate scores
with its existing records. Names, phone numbers, account or profile identifiers,
coordinates, free text, tokens and other personal data do not belong in the
ranking payload. The ranker has no database access and does not hydrate profiles
or contact external recommendation or AI providers.

| Evidence field | Accepted values |
| --- | --- |
| `completed` | Integer `0`–`1,000,000` |
| `review_count` | Integer `0`–`1,000,000`, no greater than completed work |
| `rating` | Number `1`–`5` when reviews exist; otherwise `null` |
| `experience_years` | Number `0`–`60`, matching native worker onboarding; scoring saturates at 10 years |
| `search_match` | Number `0`–`1` |
| `has_query` | Boolean |
| `available_now` | Boolean |

Validation rejects extra fields, nonfinite numbers and type coercion. For
example, a string containing a number cannot substitute for numeric evidence.
The response contains `version: "hire-evidence-v1"` and a `scores` array in the
same order as the input, with a numeric score and fixed explanation components.

`backend/hire_ranking_service.py` exposes only `GET /health` and
`POST /internal/hiring/rank`; it disables interactive API documentation. The
POST route requires a Google-issued identity token for the stable service
audience and the exact configured parent runtime service account. Cloud Run IAM
must also require authentication. Health is unauthenticated inside the process
so platform probes can check it; Cloud Run still protects HTTP access to the
service. Do not make the service public to simplify a health check.

Identity verification needs outbound HTTPS to Google's public certificate
endpoint on `www.googleapis.com`. The service applies a one-second certificate
request timeout and reuses at most four public certificate responses within
Google's cache lifetime, capped at one hour. This cache contains no identity
tokens or profile data and refreshes only as requests require it.

The ranker retains at most 128 numeric batch results per process and reuses a
result for at most 60 seconds. Cache keys depend on numeric evidence content and
scorer version, not identities or authorization. Changed evidence, including
availability, immediately changes the key. It is an in-memory calculation cache;
there is no shared cache, disk persistence, database cache or background refresh.

## Runtime configuration

| Setting | Location | Meaning |
| --- | --- | --- |
| `REPAIDO_HIRE_RANKING_URL` | Calling API | Optional HTTPS `run.app` origin, without a path, query, credentials or fragment. Leave unset for inline execution. |
| `REPAIDO_HIRE_RANKING_AUDIENCE` | Ranker | Exact stable HTTPS `run.app` origin from Cloud Run `status.url`, with no trailing slash. Use the stable origin as the ID-token audience even when validating a tagged revision. |
| `REPAIDO_HIRE_RANKING_CALLER_EMAIL` | Ranker | Exact runtime service-account email of the calling API. A user token or another service account does not qualify. |

The optional client uses the stable ranker origin as its token audience. Keep
the calling API's default inline mode until a private candidate is validated.
The remote client falls back to the same local calculation when the optional
service is unavailable; remote ranking must not block access to existing hiring
profiles. It limits remote scoring to two simultaneous calls per process and
uses a one-second scoring-request timeout; failures skip remote calls for 30
seconds. Missing or expired credentials trigger at most one background identity
refresh thread per API process, and that recommendation request returns the
inline result immediately. Token transport has a 0.5-second timeout per request;
Google discovery retries run in the bounded refresh worker and never delay the
profile response. Actual requests trigger refresh; there is no scheduled warmer
or unbounded executor.
Do not send browser or member tokens to the private service.

The optional image is built with `backend/Dockerfile.hire-ranking` and
`backend/requirements-hire-ranking.txt`. It copies only `hire_ranking.py`,
`hire_ranking_service.py` and `http_boundary.py` as application modules. Its
dependency set contains FastAPI, Uvicorn, Google token verification and their
required runtime dependencies, including Requests. It has no Firebase Admin,
Firestore, storage, media, PDF or machine-learning dependencies. Run it as the
included non-root user with a dedicated runtime service account that has no
application database or storage roles. The image limits JSON bodies to 16 KiB,
admits at most 16 requests plus 16 waiting requests per process, and bounds body
idle time to two seconds and total body transfer to five seconds. These process
limits complement the Cloud Run settings below.

| Cloud Run control | Optional ranker value |
| --- | --- |
| Billing | Request-based, CPU throttled while idle |
| Minimum instances | `0` |
| Maximum instances | `2` |
| CPU | `1` |
| Memory | `256Mi` |
| Concurrency | `16` |
| Request timeout | `5s` |
| Invocation | IAM required; only the exact parent runtime service account is granted `roles/run.invoker` |

Zero minimum instances permits cold starts. Maximum instances bounds capacity;
it is not a spend limit. Do not add Scheduler jobs, periodic probes or warming
requests to keep this small service alive. No deployment workflow, production
trigger, live capacity, IAM policy or scheduler is changed by these files.

## Local checks

Run the targeted backend ranking tests in the repository's Python environment.
The ordinary hiring flow remains usable with `REPAIDO_HIRE_RANKING_URL` unset.
An optional image can be built locally from the repository root:

```sh
docker build --file backend/Dockerfile.hire-ranking \
  --tag repaido-hire-ranking:local backend
```

In a managed cloud development environment, preserve the configured proxy and
mount its combined CA bundle for the networked build step:

```sh
docker build --file backend/Dockerfile.hire-ranking \
  --secret id=proxy_ca,src=/etc/ssl/certs/ca-certificates.crt \
  --tag repaido-hire-ranking:local backend
```

This mount does not persist the development proxy's CA in the image. Runtime
HTTPS token verification in the managed environment needs the equivalent
read-only CA mount and Requests trust setting. Production uses its normal
trusted HTTPS path. Keep TLS verification enabled.

## Manual release reference

**The following commands are templates for a later explicitly requested
release. Do not run them during development or onboarding.** Follow
[the repository release rules](../AGENTS.md) and the
[manual release workflow](CLOUD_BUILD.md). Do not add this optional service to
automatic production triggers. Image upload, service creation, IAM changes,
runtime configuration and traffic promotion are release actions.

Replace every placeholder with reviewed current configuration. Obtain the parent
runtime account from the actual calling service rather than assuming it is the
main API account. Use an already reviewed dedicated ranker runtime account and
an existing approved image repository; provisioning those resources is separate
release work. Keep all credentials out of command arguments and files.

```sh
RANKING_PROJECT=REVIEWED_PROJECT_ID
RANKING_REGION=REVIEWED_REGION
RANKING_SERVICE=repaido-hire-ranking
PARENT_SERVICE=ACTUAL_CALLING_SERVICE
RANKING_RUNTIME_SA=DEDICATED_RANKER_RUNTIME_SERVICE_ACCOUNT_EMAIL
RANKING_IMAGE=APPROVED_REGISTRY_IMAGE_WITH_IMMUTABLE_RELEASE_TAG

PARENT_RUNTIME_SA="$(gcloud run services describe "$PARENT_SERVICE" \
  --project="$RANKING_PROJECT" --region="$RANKING_REGION" \
  --format='value(spec.template.spec.serviceAccountName)')"

docker build --file backend/Dockerfile.hire-ranking \
  --tag "$RANKING_IMAGE" backend
docker push "$RANKING_IMAGE"

gcloud run deploy "$RANKING_SERVICE" \
  --project="$RANKING_PROJECT" --region="$RANKING_REGION" \
  --image="$RANKING_IMAGE" --service-account="$RANKING_RUNTIME_SA" \
  --port=8080 --cpu=1 --memory=256Mi --concurrency=16 --timeout=5s \
  --min-instances=0 --max-instances=2 --cpu-throttling \
  --no-allow-unauthenticated --no-traffic --tag=ranking-review \
  --set-env-vars="REPAIDO_HIRE_RANKING_CALLER_EMAIL=$PARENT_RUNTIME_SA"

RANKING_URL="$(gcloud run services describe "$RANKING_SERVICE" \
  --project="$RANKING_PROJECT" --region="$RANKING_REGION" \
  --format='value(status.url)')"

gcloud run services update "$RANKING_SERVICE" \
  --project="$RANKING_PROJECT" --region="$RANKING_REGION" \
  --update-env-vars="REPAIDO_HIRE_RANKING_AUDIENCE=$RANKING_URL" \
  --no-traffic --tag=ranking-review

gcloud run services add-iam-policy-binding "$RANKING_SERVICE" \
  --project="$RANKING_PROJECT" --region="$RANKING_REGION" \
  --member="serviceAccount:$PARENT_RUNTIME_SA" --role=roles/run.invoker

gcloud run services get-iam-policy "$RANKING_SERVICE" \
  --project="$RANKING_PROJECT" --region="$RANKING_REGION"
```

For a new service, the first revision deliberately has no configured audience
and refuses ranking. Discover `status.url`, then create the candidate revision
with that exact audience as shown. For an existing service, preserve its other
reviewed settings and use `--update-env-vars` instead of replacing its environment.
Verify there is no `allUsers` or `allAuthenticatedUsers` invoker grant and no
disabled invoker IAM check, including inherited permissions. Avoid granting
project-wide invoker access.

Validate the tagged candidate with a token issued for `RANKING_URL` and the
configured parent runtime account. Check health, the numeric POST response,
rejection of a missing token and a different caller, and rejection of payloads
containing unknown fields or values outside the numeric bounds. Do not print
identity tokens or use real profiles as test payloads. If impersonation is used,
the release operator needs separately reviewed permission on that exact caller
account.

Only after candidate validation, promote its recorded revision under the
requested release. Then prepare a no-traffic revision of the actual parent
service with `REPAIDO_HIRE_RANKING_URL` set to the stable ranker origin, validate
the profile flow and promote it using the existing parent release process.
Rollback consists of preparing and validating a parent revision with the optional
URL removed; inline scoring remains the default. Do not update the parent
service's unrelated capacity, secrets or environment settings.

## Measure before expanding

Compare inline and remote execution using representative payloads and observed
traffic. Record latency, cold starts, fallback frequency, CPU and memory,
Cloud Run billed instance time and requests, parent API request duration,
network transfer, build time and image storage over the same period. Use actual
billing reports and deployed configuration; no cost reduction has been measured
by this change. Include certificate verification requests and cold starts in
that comparison. Retain inline execution when isolation does not justify the
extra service and operational work.
