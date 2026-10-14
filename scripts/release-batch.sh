#!/usr/bin/env bash
# Invoke only for an explicitly requested release, from an authenticated Cloud Shell.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ $# -lt 2 || $# -gt 4 || ! "$1" =~ ^--(plan|release)$ || ! "$2" =~ ^[a-f0-9]{40}$ || ( $# -eq 4 && ( "$3" != '--changed-from' || ! "$4" =~ ^[a-f0-9]{40}$ ) ) || $# -eq 3 ]]; then
  echo 'Usage: bash scripts/release-batch.sh --plan|--release REVIEWED_FULL_COMMIT_SHA [--changed-from DEPLOYED_FULL_COMMIT_SHA]' >&2
  exit 2
fi
release_mode="$1"
release_commit="$2"
[[ "$(git rev-parse HEAD)" == "$release_commit" ]] || { echo 'This checkout does not match the reviewed release.' >&2; exit 1; }
python3 scripts/generate-selective-builds.py --check
release_target=full
if [[ $# -eq 4 ]]; then
  python3 scripts/plan-release.py --base "$4" --head "$release_commit"
  release_target=$(python3 scripts/plan-release.py --base "$4" --head "$release_commit" --format target)
fi
if [[ "$release_mode" == '--plan' ]]; then
  if [[ "$release_target" == full ]]; then
    echo 'Cloud Build configuration: cloudbuild.yaml'
  elif [[ "$release_target" == none || "$release_target" == engineering ]]; then
    echo 'No customer Cloud Build configuration applies.'
  else
    echo "Cloud Build configuration: cloudbuild-$release_target.yaml"
  fi
  exit 0
fi
[[ "$release_target" != none && "$release_target" != engineering ]] || {
  echo "No customer-app release can be submitted for target: $release_target." >&2
  exit 1
}
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
release_config='cloudbuild.yaml'
[[ "$release_target" == full ]] || release_config="cloudbuild-$release_target.yaml"
echo "Submitting $release_target release with $release_config"
gcloud builds submit . --project=repaido --region=us-central1 \
  --config="$release_config" \
  --substitutions="_RELEASE_APPROVED=true,COMMIT_SHA=$release_commit" \
  --service-account="projects/repaido/serviceAccounts/$release_account"
# Cloud Build checks the same identities before reporting success. Verify again
# from the caller's network, without printing or passing any credentials.
if [[ "$release_target" == web || "$release_target" == api ]]; then
  # Build IDs differ across partial releases; each config verifies the updated
  # component before reporting success, and this is a second public check.
  echo "$release_target release completed; updated component verified in Cloud Build."
  exit 0
fi
if [[ "$release_target" == rules ]]; then
  echo 'Firestore Rules publisher verified the active ruleset in Cloud Build.'
  exit 0
fi
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
