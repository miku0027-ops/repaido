#!/usr/bin/env bash
# Corrected Repaido Go release after the diagnosed container packaging failure.
(
  set -euo pipefail
  umask 077
  export PATH="$HOME/repaido-bike-runtime-setup.x6Q2yE/tools:$PATH"
  export CHECKPOINT_DISABLE=1
  command -v gcloud >/dev/null
  command -v terraform >/dev/null
  REPAIDO_RELEASE_DIR="$HOME/repaido-release-c9dfef42ad03"
  mkdir -p "$REPAIDO_RELEASE_DIR"
  printf 'Keep release records: %s\n' "$REPAIDO_RELEASE_DIR"
  if ! test -d "$REPAIDO_RELEASE_DIR/repo"; then
    git clone --depth=32 --single-branch --branch codex/go-release-fix-c9dfef4 \
      https://github.com/miku0027-ops/repaido.git "$REPAIDO_RELEASE_DIR/repo"
  fi
  cd "$REPAIDO_RELEASE_DIR/repo"
  test "$(git rev-parse HEAD)" = c9dfef42ad03d2f4e9c1aea4a94fbab44ace2a61
  test -z "$(git status --porcelain)"
  REPAIDO_BUILD_ID=$(gcloud builds list --project=repaido --region=us-central1 \
    --filter='substitutions.COMMIT_SHA=c9dfef42ad03d2f4e9c1aea4a94fbab44ace2a61' \
    --sort-by='~createTime' --limit=1 --format='value(id)')
  if test -z "$REPAIDO_BUILD_ID"; then
    if test -f "$REPAIDO_RELEASE_DIR/build-submission-started.txt"; then
      echo 'STOP: A submission was already started. Send the saved release log; no duplicate build was submitted.'
      exit 1
    fi
    gcloud builds describe d84c1d0c-45f0-4255-a95c-a4f4c6ce5c70 \
      --project=repaido --region=us-central1 \
      --format=json \
      > "$REPAIDO_RELEASE_DIR/previous-failed-build.json"
    gcloud logging read 'resource.type="build" AND resource.labels.build_id="d84c1d0c-45f0-4255-a95c-a4f4c6ce5c70"' \
      --project=repaido --freshness=30d --order=desc --limit=250 --format=json \
      > "$REPAIDO_RELEASE_DIR/previous-build-log.json"
    python3 -u - "$REPAIDO_RELEASE_DIR" <<'PY'
import json, re, runpy, sys
from pathlib import Path
root = Path(sys.argv[1])
failed = json.loads((root/'previous-failed-build.json').read_text())
assert failed['status'] == 'FAILURE' and failed['substitutions']['COMMIT_SHA'] == '99533896e4a76438892f7d344bdaa632ee06309e'
assert failed.get('id') == 'd84c1d0c-45f0-4255-a95c-a4f4c6ce5c70', 'Unexpected failed build receipt.'
rows = json.loads((root/'previous-build-log.json').read_text())
log = '\n'.join(str(row.get('textPayload', '')) for row in reversed(rows))
assert 'Container COPY omits local runtime dependencies' in log and 'ride_alerts.py' in log, 'STOP: The cloud failure differs from the local diagnosis. Send the last build log; no new build was submitted.'
assert re.search(r'\b1 failed,\s+\d+ passed', log), 'STOP: The cloud log does not confirm exactly one failing test. Inspect the saved log before another build.'
runpy.run_path('backend/test_container_packaging.py')['test_backend_container_packages_its_local_import_dependencies']()
print('Confirmed the original cloud packaging failure; the corrected container dependency check passes.', flush=True)
PY
    test "$(gcloud builds describe 960c1581-c130-4a52-b91f-81ac083d7475 \
      --project=repaido --region=us-central1 --format='value(substitutions.COMMIT_SHA)')" = b4e6e408cbbeed54f9fa3000a9f36fe4a928e277
    python3 -u - <<'PY'
import json, urllib.request
for origin in ('https://repaido-api-133610574058.us-central1.run.app',
               'https://repaido-work-api-133610574058.us-central1.run.app'):
    with urllib.request.urlopen(origin+'/api/health', timeout=30) as response:
        health = json.load(response)
    assert health['status'] == 'ok' and health['build_id'] == '960c1581-c130-4a52-b91f-81ac083d7475', 'Serving API changed; stop before submitting.'
print('Both current API baselines verified.', flush=True)
PY
    gcloud run services list --project=repaido --region=us-central1 \
      --format='json(metadata.name,status.traffic,status.latestReadyRevisionName)' \
      > "$REPAIDO_RELEASE_DIR/traffic-before.json"
    date -u +%FT%TZ > "$REPAIDO_RELEASE_DIR/build-submission-started.txt"
    if ! bash scripts/release-cpanel-backend.sh \
      --release c9dfef42ad03d2f4e9c1aea4a94fbab44ace2a61 \
      --changed-from b4e6e408cbbeed54f9fa3000a9f36fe4a928e277 \
      2>&1 | tee "$REPAIDO_RELEASE_DIR/release.log"
    then
      echo 'STOP: Keep the release folder and send the final output. Do not submit another build.'
      exit 1
    fi
    REPAIDO_BUILD_ID=$(gcloud builds list --project=repaido --region=us-central1 \
      --filter='substitutions.COMMIT_SHA=c9dfef42ad03d2f4e9c1aea4a94fbab44ace2a61' \
      --sort-by='~createTime' --limit=1 --format='value(id)')
  fi
  test -n "$REPAIDO_BUILD_ID"
  gcloud builds describe "$REPAIDO_BUILD_ID" --project=repaido --region=us-central1 \
    --format=json \
    > "$REPAIDO_RELEASE_DIR/backend-release.json"
  python3 -u - "$REPAIDO_RELEASE_DIR" <<'PY'
import json, re, runpy, sys, time, urllib.request
from pathlib import Path
from types import SimpleNamespace
root = Path(sys.argv[1])
setup = runpy.run_path('infra/bike-runtime/activate.py')
runner = setup['Runner']()
try:
    build = json.loads((root/'backend-release.json').read_text())
    print(json.dumps({'id':build.get('id'), 'status':build.get('status'),
                     'substitutions':{key:build.get('substitutions', {}).get(key)
                         for key in ('COMMIT_SHA', '_RELEASE_APPROVED')}}, indent=2), flush=True)
    assert build['status'] == 'SUCCESS', 'Existing build is not successful. Send this status; no new build was submitted.'
    assert build['substitutions']['COMMIT_SHA'] == 'c9dfef42ad03d2f4e9c1aea4a94fbab44ace2a61'
    assert build['substitutions']['_RELEASE_APPROVED'] == 'true'
    for origin in ('https://repaido-api-133610574058.us-central1.run.app',
                   'https://repaido-work-api-133610574058.us-central1.run.app'):
        with urllib.request.urlopen(origin+'/api/health', timeout=30) as response:
            health = json.load(response)
        assert health['status'] == 'ok' and health['build_id'] == build['id'], 'Serving API does not match the successful release.'
    print('Both APIs are serving the successful release.', flush=True)
    directory = root/'runtime'
    if not directory.exists():
        setup['prepare'](runner, SimpleNamespace(
            state_bucket='repaido-bike-runtime-tfstate-133610574058',
            quota_secret_version='projects/repaido/secrets/repaido-bike-promo-quota/versions/1',
            maximum_workers=2, alert_email='', directory=str(directory)))
    directory, manifest = setup['load'](str(directory))
    assert manifest['baseline']['build_id'] == build['id'], 'Worker plan belongs to a different API build.'
    assert not manifest['adoption'], 'Unexpected state adoption; stop.'
    if not (directory/'infra-applied.json').exists():
        assert not (directory/'apply-started.json').exists(), 'Worker apply was interrupted; preserve records for inspection instead of repeating it.'
        plan = runner.tf(directory/'terraform', 'show', '-json', 'launch.tfplan')
        changes = {row['address']: row['change']['actions'] for row in plan.get('resource_changes', [])
                   if row.get('mode') != 'data' and row['change']['actions'] != ['no-op']}
        expected = {'module.dispatch[0].google_compute_instance_template.worker': ['create','delete'],
                    'module.dispatch[0].google_compute_region_instance_group_manager.workers': ['update']}
        assert not changes or changes == expected, 'Unexpected worker resources would change; no apply performed.'
        if changes:
            template = next(row for row in plan['resource_changes'] if row['address'].endswith('.google_compute_instance_template.worker'))
            before = template['change']['before']['metadata_startup_script']
            after = template['change']['after']['metadata_startup_script']
            images = set(re.findall(r'us-central1-docker\.pkg\.dev/repaido/cloud-run-source-deploy/repaido-api@sha256:[a-f0-9]{64}', before))
            assert len(images) == 1 and before.replace(next(iter(images)), manifest['baseline']['image']) == after, 'Worker startup changes exceed the image update; no apply performed.'
        print('Verified image-only worker update: two steady workers, at most two temporary surge workers.', flush=True)
        (directory/'apply-started.json').write_text(json.dumps({'at':int(time.time()),'build':build['id']})+'\n')
        setup['apply_infra'](runner, SimpleNamespace(directory=str(directory)))
    for attempt in range(31):
        try:
            setup['verify_pool'](runner, manifest)
            print('Both worker zones are healthy on the reviewed API image.', flush=True)
            break
        except setup['SetupError'] as error:
            if attempt == 30:
                raise
            print(str(error), flush=True)
            time.sleep(10)
    with urllib.request.urlopen('https://repaido-api-133610574058.us-central1.run.app/api/operations/bike-rides/policy', timeout=30) as response:
        policy = json.load(response)
    report = {'status':'backend_and_workers_verified','commit':build['substitutions']['COMMIT_SHA'],
              'build_id':build['id'],'worker_zones_healthy':True,
              'bike_readiness':{key:policy.get(key) for key in (
                  'bookings_available','dispatch_ready','geography_ready','paid_ready','promo_ready','routing_ready')}}
    assert policy.get('dispatch_ready') is True, 'Dispatch readiness failed after the worker update.'
    (root/'cloud-release-complete.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2), flush=True)
except (setup['SetupError'], AssertionError, OSError, ValueError) as error:
    print('STOP: '+str(error)+' Preserve the release records and send the output.', flush=True)
    raise SystemExit(1)
PY
  echo 'Send the final output to Codex to publish and verify the staged website.'
)
