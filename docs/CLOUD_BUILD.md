# Cloud Build deployment

Configure the GitHub push trigger for `miku0027-ops/repaido`, branch `^main$`,
using the repository configuration file `/cloudbuild.yaml`.
Include both frontend and backend changes in the trigger; do not filter it to
only one subdirectory. The trigger must use project `repaido`.

The pipeline runs the backend tests, frontend tests and production build, then
builds and pushes the backend container. It deploys a unique no-traffic Cloud Run
candidate and checks its health and build ID before deploying Firebase Hosting.
It then directs backend traffic to that exact revision and checks both published
build IDs through Firebase Hosting. A failed step fails the build; it does not
automatically roll back a Hosting release or Cloud Run traffic change.

Targets:
- Firebase project/site: `repaido` (existing `firebase.json` and `.firebaserc`).
- Cloud Run: `repaido-api` in `us-central1`.
- Image: `us-central1-docker.pkg.dev/repaido/cloud-run-source-deploy/repaido-api`.
  Override `_IMAGE` if the existing Artifact Registry repository differs.

The existing Cloud Run service must exist. Deployment preserves its runtime
identity, secrets and environment, adding only `REPAIDO_BUILD_ID`. The Dockerfile
includes `b2b.py`, which is imported by the API. Hosting deployment is restricted
to `--only hosting`; Firestore rules and indexes are not deployed.

Use a build service account with Artifact Registry Writer on the image repository,
Cloud Run Developer and Invoker on the service, Service Account User on the
runtime identity, Logs Writer, Firebase Hosting Admin and Service Usage Consumer.
The relevant APIs must be enabled and the image repository must exist. No Firebase
login token or service-account key should be committed: the Firebase CLI uses the
Cloud Build service account through Application Default Credentials.
Build output is sent to Cloud Logging (`options.logging: CLOUD_LOGGING_ONLY`).
The build identity needs Logs Writer, and users viewing logs need Logs Viewer.

Inspect the trigger build in Cloud Build History after pushing. Verify the deployed
commit at `https://repaido.web.app/build-info.json` and the backend build ID at
`https://repaido.web.app/api/health`. Only matching IDs establish that both components
are serving the same build. Unique build tags avoid selecting another concurrent
build's revision, but production trigger runs should be serialized or superseded
runs cancelled to avoid an older build finishing after a newer one.

For manual submission from the repository root:

```sh
gcloud builds submit . --project=repaido --region=us-central1 \
  --config=cloudbuild.yaml \
  --service-account=projects/repaido/serviceAccounts/BUILD_ACCOUNT_EMAIL
```

The root `.gcloudignore` includes backend tests and Firebase configuration, and
excludes dependencies, databases and environment files. Review the source upload
inventory with `gcloud meta list-files-for-upload` before manual submission.
