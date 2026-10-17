# Pinned index and API deployment

Application source: `36bb5d925305ab4046e08d4dae7372058b1c0a41`. Previous API source: `0bc8da6a22869d30a6cabd91782d3ac15d04570c`. The helper branch contains deployment support; it does not change the selected application source.

The portable prepare.py reads a clean checkout of the exact application commit and creates a 940-file archive. verify_payload.py checks every unpacked file, manifest and configuration hash. Gzip bytes may vary across Python/zlib versions; the complete unpacked SHA-256 inventory must match.

| Prepared artifact | Reference SHA-256 |
| --- | --- |
| Source archive, 83,215,427 bytes | `3018b9485a30c9ea4f12c7adf3f32e4f763e162cd32e022034c9e329dce5bc73` |
| cloudbuild-api-index-gated.json | `08e1122a02b186082588c5a78e5ce39c6e3e822127936a7ed2dfd08804ce7c5a` |
| reviewed-source.json | `3c9e1ecfcd6daa3fd5c7acb2f60169c25790b743700170ed65062052707e77d5` |

All eleven original API build steps are preserved. Additional gates check exact source/project/approval before executing repository code, publish the three reviewed additive indexes before tests, and check all seven desired indexes READY immediately before main/work deployments. The saved approval default remains false. Firestore Rules and Firebase Hosting are unchanged.

The index publisher permits only these three additions to the four existing baseline definitions, all with COLLECTION scope:

- ops_market_chat_inbox: user_id ascending, updated_at descending, __name__ descending.
- ops_market_chat_inbox: user_id ascending, side ascending, updated_at descending, __name__ descending.
- ops_saved_alert_checks: active ascending, next_check_at ascending, __name__ ascending.

Missing baseline indexes, foreign project/database resources, malformed metadata and NEEDS_REPAIR states stop the release. Unrelated valid indexes are preserved. Duplicate creates require fresh exact-definition readiness. No deletion, Rules publication, database creation, IAM grants or application document writes occur in the publisher. Index creation polls up to 1,200 seconds; the full API build timeout is 3,600 seconds.

Two production API behaviors are covered by regression tests: nonzero pageSize causes HTTP 400, so listing uses the server default; collection-scoped list responses include other collection groups, so the transport filters valid same-project/database records by group. Project/database validation remains strict. All 27 publisher tests pass, including the reproduced failures, and all ten source-guard acceptance/tampering cases pass. A standalone migration created only the three approved definitions and verified all seven READY.

Use the signed-in Cloud Shell account through deploy.py. It checks no active global/regional builds, live API/website provenance, and records existing Cloud Run traffic and Scheduler state before uploading one exact source generation and submitting one approved build. Keep submission.json and rollback-metadata. A submission timeout can conceal an accepted build; do not remove the marker or run a fresh extracted copy to force another attempt. Check build history first.

A failed deployment after work-service changes can leave traffic partially promoted or Scheduler paused. Restore the saved compatible traffic and scheduling state if necessary; keep the harmless additive indexes. The original API pipeline does not provide automatic rollback. No real notification dispatch should be manually triggered just for a smoke test.

Publish the cPanel website only after a successful matching API build: verify backup and staging, install content-addressed assets first with full public-byte SHA-256 checks, then publish index.html and build-info.json last. Run scripts/verify-cpanel-release.py with the real Build ID, browser checks, and confirm a normal scheduled worker attempt. A worker health response alone does not execute saved-alert queries.

Deployment credentials belong only in secure environment settings. The local helper uses the existing gcloud sign-in and holds a short-lived token only in memory. The build identity acquires its own short-lived credential for Firestore. Do not put tokens into source, configuration files, logs or chat.
