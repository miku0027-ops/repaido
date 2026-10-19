# Pinned API release for a767f22

These helpers deploy application commit `a767f224cba32b60f47b0cd00ae86300c06e354a` from the verified production baseline `f1ef43876da329647283fcbb704aaca6944e0693` / API build `dbb737d0-bbc8-4f19-8ac9-93e327517c28`.

They use only Python 3 standard library, Git, and the existing authenticated Google Cloud Shell `gcloud` CLI. Do not supply or share service-account keys or tokens. The source archive is generated locally from Git; no release ZIP download is required.

## Prepare and deploy

Clone the reviewed helper branch with its history. Copy this helper directory outside that checkout so the generated archive and submission records survive later checkout operations. From the copied helper directory run:

```bash
python3 prepare.py /absolute/path/to/clean/repaido-checkout
python3 deploy.py --check-package
python3 deploy.py
```

`prepare.py` requires a clean checkout with the application commit in its ancestry. A later helper-branch HEAD is permitted. It archives application files only from the pinned application commit, never from that later HEAD or the working tree. Every application/support file must match the reviewed SHA-256 manifest. Gzip byte differences between Python/zlib versions are allowed only if every unpacked file and the exact archive inventory still match.

The final command checks that no build is active in `global` or `us-central1`, verifies the old successful build and live API/website baseline, and saves current Cloud Run traffic and Scheduler metadata. It exclusively claims `submission.json` before its first cloud mutation, uploads one immutable source generation, and submits one explicitly approved API build using the existing deployment account. It does not update any automatic trigger.

## What changes

The build preserves all eleven canonical API steps. Before repository code executes, a pinned project/commit/approval/service/image guard checks the complete source inventory and every digest. The existing Docker BuildKit configuration is preserved.

Only the new `ops_jobs(worker_id ASC, state ASC, __name__ ASC)` composite index may be created. All seven baseline indexes must already exist. All eight desired indexes must become `READY`, and a fresh read checks them again before main/work deployment and before **each traffic promotion**. A missing baseline, `NEEDS_REPAIR`, unknown state, malformed/foreign metadata, or timeout stops the build. Unrelated indexes are preserved.

The build updates the main API and the two existing work services using one image, preserves the existing candidate health/Firestore/media/routing checks, and verifies matching public API build IDs. No index deletion, Rules publication, Firebase Hosting release, database creation, IAM grant or application-record migration is added by these helpers. The original work-service deployment may reconcile its existing authenticated Scheduler configuration.

The website is not published by this helper. After API success, send the printed Build ID and final status to Codex so the separately staged website can be published and checked against the same API release. Hourly policy activation and worker acceptance remain explicit company-admin business actions.

## If interrupted

Do not rerun after submission or remove `submission.json`. A lost response can hide an accepted build. Keep that record and `rollback-metadata`; inspect the existing Build ID/history before another attempt. A fresh extracted copy must not be used to bypass the guard. If failure occurs before submission, share the phase/error for review rather than deleting the record.

The canonical pipeline has no automatic rollback. A failure after partial promotion may require restoring saved compatible Cloud Run traffic and the Scheduler's prior state. Keep additive indexes. A completed worker health check does not prove notification-provider/device delivery; do not manually dispatch real user notifications just to test the release.

## Offline validation

The complete archive and config pass `deploy.py --check-package`; `scripts/check-build-source.py` accepts all 1,268 source inputs. All **38 offline tests** pass: 27 reused additive-index gate cases and 11 exact-source/canonical-step/tampering/helper-branch preparation cases. No cloud call, upload, index creation, build submission, or production deployment was performed while preparing these helpers.

`package-info.json` records the reference archive size/digest, source/config/manifest hashes and the single approved index addition. The archive itself is intentionally not committed to Git.
