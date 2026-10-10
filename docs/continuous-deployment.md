# Repaido frontend deployment

## Status

This change prepares Cloud Build deployment to Firebase Hosting. It does not
create a trigger, grant IAM permissions, move domains, or deploy a website.
Google Cloud authentication and inspection of the live Hosting sites are still
required before activation. No GitHub Actions or App Hosting service is needed.

## Required environment separation

- Test: project `repaido`, Hosting site `repaido`, URL `https://repaido.web.app`.
- Production: a separate Hosting site in the same project, with `repaido.com`
  and any production aliases mapped to it. Choose the site ID after inspecting
  existing sites; do not create a duplicate if a suitable production site exists.
- Before moving a custom domain, record its current site, release version, DNS
  and certificate state. Populate the production site with the current approved
  production release first. Domain reassignment may require DNS changes and
  certificate provisioning; schedule and verify the cutover before enabling CD.
- The guard refuses all custom domains on the test site, including pending
  domains, and fails on authentication/API errors. It checks before the build and
  immediately before deployment. It cannot protect against an administrator
  remapping domains concurrently; do not change domain mappings during builds.
- Both root and `web/firebase.json` currently route `/api/**` to `repaido-api`
  in `us-central1`. Separate Hosting sites do NOT isolate backend data or Firebase
  Authentication/Firestore. Inspect the app's Firebase configuration and backend
  before running destructive tests. Backend deployment is outside this pipeline.

## One-time Google Cloud setup

1. Authenticate in a trusted Google Cloud environment and select project
   `repaido`. Inspect Hosting sites, custom domains, existing triggers and IAM.
2. Enable the Cloud Build and Firebase Hosting APIs if necessary. Connect only
   `miku0027-ops/repaido` using the supported Cloud Build GitHub connection.
   GitHub may require the account owner to approve its GitHub App installation.
3. Create a dedicated build service account. Start with Firebase Hosting Admin
   (`roles/firebasehosting.admin`), Logs Writer (`roles/logging.logWriter`), and
   Service Usage Consumer (`roles/serviceusage.serviceUsageConsumer`). Because
   Firebase Hosting roles can cover multiple sites, use a site-scoped IAM
   condition/custom role where supported and verify it before activation. Do not
   grant Owner or Editor. Additional narrowly scoped read access may be needed
   for Firebase CLI validation of the existing Cloud Run rewrite; diagnose the
   specific denied permission rather than granting Cloud Run Admin. Configure
   source-connection access as required by the chosen Cloud Build connection.
   Use the attached service account, not downloaded JSON keys or Firebase tokens.
4. Create a push trigger for branch regex `^main$`, config `cloudbuild.test.yaml`,
   using that dedicated service account. Include only these paths:

   ```text
   web/**
   firebase.json
   .firebaserc
   cloudbuild.test.yaml
   scripts/prepare-test-hosting.py
   scripts/test_prepare_test_hosting.py
   ```

   Exclude documentation-only and generated changes where appropriate. Do not
   create a production auto-deploy trigger. Keep the trigger disabled until the
   domain separation and first supervised build are verified.
5. Run the safety tests with
   `python3 -m unittest discover -s scripts -p 'test_prepare_test_hosting.py'`.
   Run a supervised build of `main` and verify tests, build output, Hosting
   release, the test homepage, deep links, and `/api` behavior. Then enable the
   push trigger. Failed tests or builds must not reach the deploy step.
6. Avoid concurrent releases: cancel obsolete builds when pushing another
   revision before the previous build finishes, and verify the deployed release
   commit against the latest intended revision. Cloud Build does not guarantee
   completion order across separate trigger executions.

## Build and cost controls

- Static Hosting; no new always-running frontend service, private build pool,
  container registry, or App Hosting backend.
- Standard default build machine, 20-minute execution timeout and 10-minute
  queue expiry. Frontend-only path filters avoid builds for backend/Android work.
- Frozen pnpm lockfile, pnpm `11.19.0` from `web/package.json`, Node 24 and pinned
  Firebase CLI `14.19.1`. Validate package availability and compatibility in the
  first supervised build; a failed install stops deployment.
- The current frontend test command covers booking tests only. Build/typechecking
  also run; this is not a complete browser or backend regression suite.
- Use Cloud Logging only, with a suitable short retention period. Retain a small
  number of Hosting releases (for example 5-10) through Hosting retention
  settings, keeping the currently approved rollback release.
- Review the billing account's current free allowances and prices before
  estimating monthly cost. Set project-scoped budget alerts at 50%, 90%, and
  100% of an agreed monthly budget. Alerts are not spending caps. If costs rise,
  pause the test build trigger; do not automatically disable production billing.
- Inspect existing Cloud Run minimum instances and traffic before changing
  backend scaling. This configuration changes no backend capacity or billing.

## Production promotion and rollback

After the user approves a tested revision, record its commit and Firebase Hosting
version. Promote that exact Hosting version to the separate production site
using Firebase Hosting's version-clone/release API or a verified Firebase CLI
version-clone command. Preserve the current production version for rollback.
Do not blindly copy `repaido:live` if another test release has landed since
approval; do not rebuild an unpinned `main` for production.

Verify `https://repaido.com`, key deep links and the API after promotion. Roll
back using the saved production release in Firebase Hosting if necessary.
Frontend rollback does not roll back backend services, rules or database data.
