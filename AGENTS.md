# Development and releases

- The user authorized automatic production releases from `main` on 10 November
  2026. A push or merge to `main` is the release signal. Use development branches
  for unfinished changes; review and test before updating `main`.
- `.github/workflows/production.yml` is the single production deploy controller.
  It uses GitHub OIDC and Google Workload Identity Federation. Do not ask for a
  fresh GCP access token for routine releases or create service-account keys.
- One-time project-owner setup is documented in `docs/GITHUB_DEPLOYMENT.md`.
  A committed workflow alone does not prove that live Google IAM is configured.
- Keep legacy Cloud Build GitHub push triggers disabled to avoid duplicate
  builds. The workflow supplies `_RELEASE_APPROVED=true` only to its pinned
  component builds; the default Cloud Build substitution stays false.
- Compare against actual deployed website and API commits. Reuse an unchanged
  API for website changes. Keep deployments serialized and never cancel a
  running promotion to make room for another commit.
- Preserve booking, location, and notification delivery. Keep candidate health,
  durable storage, API identity, backup and post-publication checks. Do not
  bypass a failed check to make a deployment appear successful.
- The customer website remains on cPanel at `repaido.com`; the APIs and private
  worker remain on GCP. Do not migrate hosting or DNS as part of routine releases.

See [automatic deployment](docs/GITHUB_DEPLOYMENT.md),
[Cloud Build](docs/CLOUD_BUILD.md), [cPanel](docs/CPANEL_RELEASE.md), and
[cost controls](docs/CLOUD_COST_CONTROLS.md).
