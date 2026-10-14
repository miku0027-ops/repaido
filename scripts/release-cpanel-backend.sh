#!/usr/bin/env bash
# One explicitly requested API release; the cPanel website is published separately.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ $# -ne 4 || "$1" != --release || "$3" != --changed-from || ! "$2" =~ ^[a-f0-9]{40}$ || ! "$4" =~ ^[a-f0-9]{40}$ ]]; then
  echo 'Usage: bash scripts/release-cpanel-backend.sh --release REVIEWED_SHA --changed-from DEPLOYED_API_SHA' >&2
  exit 2
fi
release_commit="$2"
release_baseline="$4"
[[ "$(git rev-parse HEAD)" == "$release_commit" && -z "$(git status --porcelain)" ]] || { echo 'Use a clean checkout of the reviewed release.' >&2; exit 1; }
git merge-base --is-ancestor "$release_baseline" "$release_commit"
[[ -z "$(git diff --name-only "$release_baseline" "$release_commit" -- firestore.rules firestore.indexes.json)" ]] || {
  echo 'Firestore Rules or indexes also changed. Publish and verify them through their reviewed pipeline before using this API-only release.' >&2
  exit 1
}
command -v gcloud >/dev/null || { echo 'Run in authenticated Google Cloud Shell for project repaido.' >&2; exit 1; }
python3 scripts/generate-selective-builds.py --check
release_inventory=$(mktemp)
trap 'rm -f -- "$release_inventory"' EXIT
gcloud meta list-files-for-upload > "$release_inventory"
python3 scripts/check-build-source.py --inventory "$release_inventory"
for release_region in global us-central1; do
  active_builds=$(gcloud builds list --project=repaido --region="$release_region" --filter='status=(QUEUED WORKING PENDING)' --format='value(id)')
  [[ -z "$active_builds" ]] || { echo "Another build is active in $release_region. Wait before submitting this release." >&2; exit 1; }
done
gcloud builds submit . --project=repaido --region=us-central1 \
  --config=cloudbuild-api.yaml \
  --substitutions="_RELEASE_APPROVED=true,COMMIT_SHA=$release_commit" \
  --service-account=projects/repaido/serviceAccounts/firebase-adminsdk-fbsvc@repaido.iam.gserviceaccount.com
echo 'API release completed and verified by Cloud Build. No Firebase Hosting or cPanel files were changed by this command.'
