# Cloud Build deployment

Release only when the user explicitly requests deployment. Keep development
changes local or on a non-deploying branch and batch them into one or two
requested releases per day. Disable the existing production GitHub push trigger
for `miku0027-ops/repaido`; do not automatically deploy on `main` pushes or on a
timer. See [cost controls](CLOUD_COST_CONTROLS.md) for the read-only audit and
trigger-disable instructions.

The first step fails before dependency installation, tests, image builds, or
deployment unless the manual batch supplies `_RELEASE_APPROVED=true` and its full
Git commit SHA. Keep this substitution false on automatic triggers. This guard
is a fallback, not a substitute for disabling the trigger: a triggered guard
failure still starts a small Cloud Build run. Repository edits alone do not
disable an existing cloud trigger.

The Python test step also installs Node.js: the camera metadata integration test
executes the frontend's actual JavaScript encoder through a Node subprocess.
Initial read-only preflights verify Cloud Build history access and access to the
existing Firestore Rules release before running the backend tests, frontend tests
and production build. The frontend step uses Node 24 on Debian Trixie with Java
21 and pinned Firebase CLI 15.32.1 to test the source rules against a loopback
Firestore emulator in a demo project. The pipeline then
builds and pushes the backend container. It deploys unique no-traffic Cloud Run
candidates for the main API, work API, and private update worker, checking their
health and build IDs. It waits for earlier builds from the same trigger, publishes
and verifies the reviewed Firestore Rules source, promotes
the verified revisions, resumes the authenticated update schedule, and deploys
Firebase Hosting. It checks the site, main API, and work API build IDs through
Hosting. A failed step fails the build; it does not
automatically roll back a Hosting release or Cloud Run traffic change.

Targets:
- Firebase project/site: `repaido` (existing `firebase.json` and `.firebaserc`).
- Cloud Run: `repaido-api` in `us-central1`.
- Work discovery: `repaido-work-api`; private delivery: `repaido-work-worker`.
- Authenticated Cloud Scheduler job: `repaido-work-updates` in `us-central1`.
- Image: `us-central1-docker.pkg.dev/repaido/cloud-run-source-deploy/repaido-api`.
  Override `_IMAGE` if the existing Artifact Registry repository differs.

The existing Cloud Run service must exist. Deployment preserves its runtime
identity and secrets, setting `REPAIDO_BUILD_ID` and explicitly selecting
`REPAIDO_STORAGE=firestore`. Before deployment proceeds, the candidate must
complete a community read/write transaction against Firestore and report a
configured durable media bucket. The Dockerfile
includes `b2b.py` and the request-boundary module imported by the API. The Firebase
CLI deployment remains restricted to `--only hosting`; a separate Rules API
publisher updates the existing `cloud.firestore` release. It compares the current
source, skips unchanged writes, compiles changed source into a ruleset, verifies
that source, activates the release and verifies the resulting ruleset identity.
It does not create a database, publish indexes or alter stored records.

Use a build service account with Artifact Registry Writer on the image repository,
Cloud Run deployment and IAM-policy permissions on the three services, Service
Account User on the runtime and dedicated Scheduler identities, Logs Writer,
Firebase Hosting Admin and Service Usage Consumer. Rules publication additionally
requires `firebaserules.rulesets.create`, `firebaserules.rulesets.get`,
`firebaserules.releases.get` and `firebaserules.releases.update`; the existing
`roles/firebase.sdkAdminServiceAgent` includes these permissions. The publisher
does not grant IAM or require Rules test/initial-release creation permissions.
Its preflight fails before expensive build steps if permissions or the existing
release are missing. The release-order check needs
`cloudbuild.builds.get` and `cloudbuild.builds.list`, included in
`roles/cloudbuild.builds.viewer`; it fails closed if it cannot read build history.
Initial work-service provisioning additionally needs service API enablement,
creation of the dedicated Scheduler service account, Cloud Scheduler job
administration, and Firestore TTL-policy configuration. The runtime account needs
FCM message-send permission for opted-in work updates. See
[the work deployment instructions](REPAIDIANS_WORK_ARCHITECTURE.md#cloud-build-and-deployment-integration)
for the service boundaries and Scheduler caller. The image repository must exist. No Firebase
login token or service-account key should be committed: the Firebase CLI uses the
Cloud Build service account through Application Default Credentials.
Build output is sent to Cloud Logging (`options.logging: CLOUD_LOGGING_ONLY`).
The build identity needs Logs Writer, and users viewing logs need Logs Viewer.

For the existing `repaido` build identity, a project owner can run the reviewed
one-time bootstrap in Cloud Shell:

```sh
bash scripts/bootstrap-work-deployment.sh repaido firebase-adminsdk-fbsvc@repaido.iam.gserviceaccount.com
```

The script grants Cloud Build Viewer, Cloud Run Admin, Cloud Scheduler Admin,
and Datastore Index Admin to this deployment identity, enables the four delivery
APIs, creates the dedicated Scheduler caller if absent, and grants the build
account Service Account User on that caller only. A separate existing API runtime
account receives FCM send capability; the current SDK account already has it.
Future builds read enabled API status and skip enablement when it is complete.
The build never runs this bootstrap or grants itself these project permissions.

Inspect the requested build in Cloud Build History after submission. Verify the deployed
commit at `https://repaido.web.app/build-info.json` and API build IDs at
`https://repaido.web.app/api/health` and
`https://repaido.web.app/api/repaidians/work/health`. Only matching IDs establish that these components
are serving the same build. Unique build tags avoid selecting another concurrent
build's revision. Tags use `b-` plus the build UUID without hyphens to stay within
Cloud Run's combined tag/service-name limit. The release-order step waits for
earlier active runs from the same trigger before changing production traffic;
an unreadable history or a wait exceeding 15 minutes fails the build.

For a requested manual batch, commit the reviewed changes and verify there are
no pending tracked or untracked source changes. Submit from the repository root
using the existing build service account; replace `BUILD_ACCOUNT_EMAIL` below.
Do not run this command during development or while another production release
is active. Manual builds have no trigger ID, so the trigger-specific ordering
step does not serialize them.

```sh
REPAIDO_RELEASE_COMMIT=$(git rev-parse HEAD)
gcloud builds submit . --project=repaido --region=us-central1 \
  --config=cloudbuild.yaml \
  --substitutions="_RELEASE_APPROVED=true,COMMIT_SHA=$REPAIDO_RELEASE_COMMIT" \
  --service-account=projects/repaido/serviceAccounts/BUILD_ACCOUNT_EMAIL
```

The root `.gcloudignore` includes backend tests, deployment scripts, rules and
Firebase/emulator configuration, and
excludes dependencies, databases and environment files. Review the source upload
inventory with `gcloud meta list-files-for-upload` before manual submission.

A reviewed, clean checkout can also use the guarded Cloud Shell helper:

```sh
bash scripts/release-batch.sh --release FULL_REVIEWED_COMMIT_SHA
```

It checks the exact commit and clean worktree, validates the actual
`gcloud meta list-files-for-upload` inventory before any upload, and refuses to submit while a build is
active in `global` or `us-central1`, and uses the existing
`firebase-adminsdk-fbsvc@repaido.iam.gserviceaccount.com` build identity. It applies
approval to that one manual build only and verifies Hosting and both public API
build IDs afterward. It does not enable or update any automatic trigger.

The upload allowlist includes shell helpers as well as Python/JavaScript files.
Backend tests execute `scripts/configure-transactional-email.sh` with a fake
gcloud; omitting it from a manual source upload causes failures even when the
full local checkout passes. `scripts/check-build-source.py` rejects that omission
and local dependency/environment files before a paid build is submitted.

## Component-scoped releases

The full batch remains `cloudbuild.yaml`. The checked-in `cloudbuild-web.yaml`,
`cloudbuild-api.yaml`, and `cloudbuild-rules.yaml` are generated from its reviewed
steps by `scripts/generate-selective-builds.py`. Run that generator after changing
the canonical pipeline, and run it with `--check` before release. All four
pipelines retain the explicit release gate; none is an automatic trigger.

| Changed component | Release work | Work skipped |
| --- | --- | --- |
| Customer/worker SPA (`web/`) | Web tests, Vite build, Firebase Hosting | Backend tests, API image, Run revisions, Rules publication |
| API (`backend/`) | Backend tests, one image, main API and both work services | Vite build, Hosting, Rules publication |
| Firestore rules | Emulator rules tests, Rules API publication | Web build, backend tests, API image, Hosting |
| Shared or multiple components | Existing full release | Nothing |
| Engineering console | Its independent `engineering/release.py` workflow | Customer pipeline |

The API and work services currently share one backend image. An API-only release
therefore updates those three services together. Splitting one endpoint into its
own deployable service would require a separate image, runtime configuration,
traffic checks, and ownership of its shared dependencies. The customer,
worker, shop-admin, and company-admin screens are routes of one web build, so a
change to any of them publishes that web build as a unit.

For a requested release, compare the reviewed checkout with the **actual
deployed commit**, then inspect the offline plan before submitting. Do not use
`HEAD~1` as a guess for production; after a partial release, web and API can
have different deployed commits. Use the oldest relevant deployed baseline to
avoid skipping changes, even when that selects the full pipeline. The first
command makes no cloud call. The second requires the user's release request and
uses the same clean-checkout, source-inventory, build-concurrency, and pinned
commit checks as the full release:

```sh
bash scripts/release-batch.sh --plan REVIEWED_FULL_COMMIT_SHA \
  --changed-from DEPLOYED_FULL_COMMIT_SHA
bash scripts/release-batch.sh --release REVIEWED_FULL_COMMIT_SHA \
  --changed-from DEPLOYED_FULL_COMMIT_SHA
```

Omit `--changed-from` to use the existing full release. The planner selects a
full release for overlapping web/API/Rules changes or unfamiliar build inputs.
It refuses to silently publish Firestore indexes, which have no release step.
Engineering console changes require a separate console release even when the
customer planner selects a customer component. The site and API build IDs will
differ after a partial release; each partial pipeline verifies only the component
it updated. A later full release restores matching IDs. Run
`python3 scripts/generate-selective-builds.py --check` and the offline
`backend/test_selective_release.py` before submitting.
