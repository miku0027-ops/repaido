# QA release: additive indexes and API build

Reviewed release: `36bb5d925305ab4046e08d4dae7372058b1c0a41`.
Recorded previous API baseline: `0bc8da6a22869d30a6cabd91782d3ac15d04570c`; revalidate that actual deployed provenance before submission. The current parent release attempt reports authenticated GCP HTTP 401. These prepared artifacts make no cloud request and do not resolve that authentication blocker.

Use these **new** artifacts together:

| Artifact | SHA-256 |
| --- | --- |
| `repaido-36bb5d925305-index-gated-source.tar.gz` (83,214,784 bytes) | `5ede61a84da9c3abd01cc4d004986a60e97ed2bdfc22aa7ac9f4696b5b3977da` |
| `cloudbuild-api-index-gated.json` | `9184cb52efa34afa4d6a6427b363f327b59432d250fedcfbc2ca27a517cefeff` |
| `reviewed-source.json` | `00aa3ae5108dd029db47a5a7721e0487311cd562a02edaa3bc5c56e8fe5cc267` |

The archive contains exactly 940 selected files: committed customer/API source plus the reviewed index publisher, baseline index document and pinned manifest. The source archive from `repaido-release-a9c2788` is superseded and omits the QA fixes. Do not use it or its staged website. Do not submit the ordinary checkout with the new JSON configuration: it lacks the support files and will fail the source guard.

## Review result

The new `index_gate.py` and `test_index_gate.py` are byte-for-byte copies of the reviewed prior publisher/tests. Their 24 offline tests passed. The builder was changed only to require `--release FULL_SHA`, permit an explicit full-SHA `--baseline`, name the archive by the new SHA, and write reproducible gzip metadata. It continues to require the exact clean checkout, an ancestor baseline, unchanged Rules source, current generated pipelines and the repository source-inventory check.

Independent validation verified every archive hash/member and all **11 original API build steps unchanged**, with four additions: exact source guard; additive index publication before backend tests; fresh check-only index reads immediately before main candidate deployment and work-service deployment. All 10 source-guard cases passed, including exact acceptance and rejection of changed/missing/extra/symlinked files, manifest tampering, wrong commit/project and false approval. See `offline-release-validation.json`.

The publisher compares pinned baseline/target definitions and permits **only the three additive indexes**. It requires all seven target definitions READY, refuses to recreate missing baseline definitions, preserves unrelated indexes, refuses destructive repair and validates duplicate-create races with fresh reads. It never deletes indexes, publishes Rules, grants IAM, creates a database or changes application records. Publication can wait up to 1,200 seconds; its step timeout is 1,500 seconds and the full build timeout is 3,600 seconds. Check-only gates fail if indexes are absent or not READY. They do not trust a previous receipt.

These offline results establish helper behavior and packaged source integrity. They do not establish live IAM, indexes, API provenance, source-bucket access, or successful application deployment. The prepared inventory is the actual archive inventory, not a claim that the unavailable `gcloud meta list-files-for-upload` command ran. No gcloud filtering is involved when submitting this already reviewed archive.

## Safe submission sequence

1. Restore usable GCP authentication through the existing secure credential binding; perform fresh read-only Cloud Build/Run calls. Do not replace injected credentials, print values, start interactive login or assume variable presence means access.
2. Revalidate actual API baseline, project `repaido`, region `us-central1`, and no active build in `global` or `us-central1`. Save full main/work/worker traffic mappings and Scheduler state for rollback, plus any already enabled optional community service. Confirm no concurrent release. The build's original history guard is retained, but manual builds are not automatically serialized.
3. Recompute the artifact digests above. Upload this exact source archive to the existing approved Cloud Build source bucket, then capture its exact object generation. Do not create a new bucket or broaden permissions to work around a denial.
4. Copy `cloudbuild-api-index-gated.json` into the build request. Add `source.storageSource` with the verified bucket, exact object name and generation. Set the request substitutions `COMMIT_SHA=36bb5d925305ab4046e08d4dae7372058b1c0a41` and `_RELEASE_APPROVED=true` for this one explicitly requested build. Preserve all other config fields. The saved configuration deliberately retains `_RELEASE_APPROVED: false`.
5. Submit that request **once** to Cloud Build in `us-central1`, using its pinned existing service account. The short-lived submitter credential stays out of the source/config. The index gate obtains its own short-lived credential inside Cloud Build via `gcloud auth print-access-token`; the build identity needs Firestore index list/create permissions, normally `roles/datastore.indexAdmin`. Do not add `firestore.googleapis.com` to the local secret's domain scope merely for this build-side publisher.
6. Record the build ID, status and three index receipts from Cloud Logging. A failed index gate prevents API deployment. If indexes exceed the timeout, inspect existing index state before any resubmission; do not blindly launch another full build. Continue through the preserved tests, shared image, no-traffic candidates, Firestore/media checks, promotions and API identity verification.
7. Only after that successful API build, publish the **new QA** cPanel archive for the same source SHA using backup/staging/asset-first/entry-last publication and run `verify-cpanel-release.py` with the actual successful build ID. Verify normal scheduled worker dispatch succeeds; worker health alone does not execute the indexed saved-alert query. Do not trigger an extra real notification run merely as a smoke test.

The existing pipeline has no automatic rollback. If a later step fails, restore saved compatible traffic and Scheduler state, checking whether deployment paused the schedule or partially promoted services. Keep the harmless additive indexes during rollback. Do not publish the new frontend against the old API solely because cPanel credentials work.

## Local reproduction

All commands below are offline and write only under this external release folder:

```sh
cd /workspace/releases/repaido-release-20261017
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest -v test_index_gate
PYTHONDONTWRITEBYTECODE=1 python3 prepare_index_release.py \
  --release 36bb5d925305ab4046e08d4dae7372058b1c0a41 \
  --baseline 0bc8da6a22869d30a6cabd91782d3ac15d04570c
PYTHONDONTWRITEBYTECODE=1 python3 validate_prepared_release.py
```

Preparation needs installed PyYAML. Cloud Build source/index guards use the standard library and existing Cloud SDK image. Regenerating replaces the generated artifacts only; confirm digests before reusing any uploaded object. Source/config publication and repository push remain unperformed by this helper work.
