# Automatic production deployment

Push or merge finished changes to `main`. GitHub Actions authenticates to Google
using Workload Identity Federation, tests the changed components, deploys healthy
Cloud Run candidates when the backend changes, and publishes the website to
`repaido.com`. No manually copied Google access token or service-account JSON key
is needed for routine releases. Other branches and pull requests cannot assume
the production identity.

The website currently lives on **cPanel**. Its APIs, data and private update worker
live on **GCP**. This workflow preserves those locations and does not change DNS.
A frontend-only change runs website tests/build and cPanel publication without a
new backend image or Cloud Run revision.

## One-time setup

Run the following in [Google Cloud Shell](https://shell.cloud.google.com/) while
signed into the Repaido project-owner account:

```bash
REPAIDO_SETUP_DIR=$(mktemp -d)
git clone --depth 1 --branch main https://github.com/miku0027-ops/repaido.git "$REPAIDO_SETUP_DIR"
python3 "$REPAIDO_SETUP_DIR/scripts/bootstrap-github-production.py"
```

The script confirms project `repaido` / `133610574058` and active project billing
before making changes. It enables only missing APIs, creates the dedicated
GitHub identity and OIDC provider, grants scoped permissions to submit builds and
read serving revisions, and creates a private build-source bucket. It reuses the
existing build account and its existing runtime permissions. It disables matching
legacy production GitHub push triggers to avoid duplicate deployment controllers.
It neither deploys application code nor creates a Google service-account key.

On its first run, it prompts for the **existing cPanel API token** with input
hidden, then saves it once as `repaido-cpanel-api-token` in Google Secret Manager.
This credential is needed because cPanel does not accept Google OIDC. Later runs
reuse the secret. Use `--replace-cpanel-token` only when rotating that token.
Never put the value in chat, source, shell command arguments or GitHub artifacts.

Allow a few minutes for Google IAM propagation. Then open
[Actions → Deploy production](https://github.com/miku0027-ops/repaido/actions/workflows/production.yml),
choose **Run workflow** on `main`, and start the first release. Future pushes run
it automatically. If the existing APIs need recovery, enable **Redeploy the API
through candidate checks for outage recovery** for this first manual run.

The GitHub `production` environment is used by the workflow. Any existing GitHub
review/branch protection rules remain in effect. Repository contents cannot
configure Google IAM by themselves; setup must succeed before deployment works.

## Billing blocks setup

`UREQ_PROJECT_BILLING_NOT_OPEN` means Google has blocked the project because its
linked billing account is not open. A new access token will not resolve this.
Open [project billing](https://console.cloud.google.com/billing?project=repaido)
and resolve the account status, payment issue, or trial/paid-account activation
shown there. An account administrator may be needed.

These commands only read the current link and accounts you can access:

```bash
gcloud billing projects describe repaido
gcloud billing accounts list --filter="open=true"
```

If you choose a different active account to pay for this project, replace
`YOUR_BILLING_ACCOUNT_ID` below with that account's ID:

```bash
gcloud billing projects link repaido --billing-account=YOUR_BILLING_ACCOUNT_ID
gcloud billing projects describe repaido
```

Once `billingEnabled: true` is reported, update your setup checkout and retry:

```bash
git -C "$REPAIDO_SETUP_DIR" pull --ff-only origin main
python3 "$REPAIDO_SETUP_DIR/scripts/bootstrap-github-production.py"
```

If the temporary checkout was removed or you opened a new Cloud Shell session,
use the fresh-checkout commands in One-time setup. The script never selects a
billing account or changes billing links automatically. Suspended billing can
also interrupt the running APIs; verify their health after billing is restored.

## What a release checks

- The immutable GitHub repository ID and owner ID, exact `main` ref, production
  environment, exact workflow path, and allowed event are required by Google.
- Each run checks out its exact commit and refuses dirty source, stale queued
  commits, unrecognized API build metadata, split production traffic, changed
  Firestore indexes, and engineering-console changes that need their own release.
- Production website metadata and serving Cloud Run revisions determine separate
  web/API baselines. A retry after a partial release does not blindly rebuild an
  already deployed API. Unknown shared build changes select the broader checks.
- Runs are serialized. A running deployment is never cancelled by a new push.
  Active Cloud Builds also block a second submission. Failed remote builds are
  inspected before a retry; the runner does not resubmit them in a loop.
- Backend tests, candidate health, Firestore/media checks and promotion remain in
  the existing Cloud Build pipeline. Rules changes keep their emulator tests.
- The website release saves a private backup outside the document root, verifies
  staging, publishes and hashes resources first, then switches entry/metadata.
  Existing hashed assets, account files, uploads and provider `.htaccess` stay.
- Live checks cover source identity, direct routes, missing-asset 404s, API build
  IDs, CORS and guest access boundaries. They do not replace signed-in payment or
  push testing with approved test accounts.

Google credentials are refreshed automatically before each long deployment
phase. The workflow has only GitHub read and OIDC permissions; it cannot push
code. Third-party Actions are pinned to commit SHAs. Temporary credential files
are excluded from Git and the Cloud Build upload allowlist.

## Failed runs and recovery

Open the failed Actions run and its `production-release-*` artifact. `plan.json`
records the actual baselines; each submitted build has a recorded ID;
`publication.json` records the private cPanel backup and last publication step.
Cloud Build logs remain in GCP. The workflow does not mask failed checks or
silently roll back API traffic. Inspect these records before re-running.

Existing API 500/503 errors are a separate problem from authentication. Website
publication stops while either API is unhealthy. Use the recovery option for a
reviewed redeployment through candidate checks; billing, quota, configuration or
provider failures must still be resolved if those checks fail.

To pause automatic releases, disable **Deploy production** in GitHub Actions.
Do not re-enable the legacy Cloud Build push trigger. Retained website assets,
private backups and Cloud Run revisions support a reviewed rollback. Source
archives, build logs and seven-day GitHub evidence retention incur normal storage
costs; this setup adds no always-on service.
