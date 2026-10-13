#!/usr/bin/env bash
# Invoke only for an explicitly requested release, from an authenticated Cloud Shell.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ $# -ne 2 || "$1" != '--release' || ! "$2" =~ ^[a-f0-9]{40}$ ]]; then
  echo 'Usage: bash scripts/release-batch.sh --release REVIEWED_FULL_COMMIT_SHA' >&2
  exit 2
fi
release_commit="$2"
[[ "$(git rev-parse HEAD)" == "$release_commit" ]] || { echo 'This checkout does not match the reviewed release.' >&2; exit 1; }
[[ -z "$(git status --porcelain)" ]] || { echo 'Commit or remove unexpected checkout changes before release.' >&2; exit 1; }
command -v gcloud >/dev/null || { echo 'Run this command in Google Cloud Shell with deployment access to repaido.' >&2; exit 1; }
# Use gcloud's actual filtering rules; do not test only the larger local checkout.
release_inventory=$(mktemp)
trap 'rm -f -- "$release_inventory"' EXIT
gcloud meta list-files-for-upload > "$release_inventory"
python3 scripts/check-build-source.py --inventory "$release_inventory"
# Keep manual batches from racing another release. Both locations have been used.
for release_region in global us-central1; do
  active_builds=$(gcloud builds list --project=repaido --region="$release_region" \
    --filter='status=(QUEUED WORKING PENDING)' --format='value(id)')
  [[ -z "$active_builds" ]] || { echo "A build is already active in $release_region. Wait for it to finish before submitting this batch." >&2; exit 1; }
done
# No trigger is enabled or modified. The override applies to this build only.
release_account='firebase-adminsdk-fbsvc@repaido.iam.gserviceaccount.com'
gcloud builds submit . --project=repaido --region=us-central1 \
  --config=cloudbuild.yaml \
  --substitutions="_RELEASE_APPROVED=true,COMMIT_SHA=$release_commit" \
  --service-account="projects/repaido/serviceAccounts/$release_account"
# Cloud Build checks the same identities before reporting success. Verify again
# from the caller's network, without printing or passing any credentials.
python3 - "$release_commit" <<'PY'
import json, sys, urllib.request
commit=sys.argv[1]
def read(path):
    with urllib.request.urlopen('https://repaido.web.app'+path+'?release='+commit,timeout=30) as response:
        return json.load(response)
site=read('/build-info.json')
assert site['commit']==commit, 'Hosting is not serving this release yet'
for path in ['/api/health','/api/repaidians/work/health']:
    health=read(path)
    assert health['status']=='ok' and health['build_id']==site['build_id'], path+' does not match this release'
print('Production verified: '+commit+' / build '+site['build_id'])
PY
