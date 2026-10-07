# Cloud Build deployment

Configure the GitHub push trigger for `miku0027-ops/repaido`, branch `^main$`,
using the repository configuration file `/cloudbuild.yaml`.
Include both frontend and backend changes in the trigger; do not filter it to
only one subdirectory. The trigger must use project `repaido`.

The Python test step also installs Node.js: the camera metadata integration test
executes the frontend's actual JavaScript encoder through a Node subprocess.
The pipeline runs the backend tests, frontend tests and production build, then
builds and pushes the backend container. It deploys unique no-traffic Cloud Run
candidates for the main API, work API, and private update worker, checking their
health and build IDs. It waits for earlier builds from the same trigger, promotes
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
includes `b2b.py`, which is imported by the API. Hosting deployment is restricted
to `--only hosting`; Firestore rules and indexes are not deployed.

Use a build service account with Artifact Registry Writer on the image repository,
Cloud Run deployment and IAM-policy permissions on the three services, Service
Account User on the runtime and dedicated Scheduler identities, Logs Writer,
Firebase Hosting Admin and Service Usage Consumer. The release-order check needs
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

Inspect the trigger build in Cloud Build History after pushing. Verify the deployed
commit at `https://repaido.web.app/build-info.json` and API build IDs at
`https://repaido.web.app/api/health` and
`https://repaido.web.app/api/repaidians/work/health`. Only matching IDs establish that these components
are serving the same build. Unique build tags avoid selecting another concurrent
build's revision. Tags use `b-` plus the build UUID without hyphens to stay within
Cloud Run's combined tag/service-name limit. The release-order step waits for
earlier active runs from the same trigger before changing production traffic;
an unreadable history or a wait exceeding 15 minutes fails the build.

For manual submission from the repository root:

```sh
gcloud builds submit . --project=repaido --region=us-central1 \
  --config=cloudbuild.yaml \
  --service-account=projects/repaido/serviceAccounts/BUILD_ACCOUNT_EMAIL
```

The root `.gcloudignore` includes backend tests and Firebase configuration, and
excludes dependencies, databases and environment files. Review the source upload
inventory with `gcloud meta list-files-for-upload` before manual submission.
