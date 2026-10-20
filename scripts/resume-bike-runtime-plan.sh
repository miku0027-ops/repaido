#!/usr/bin/env bash
# Resume the inspected prerequisites; preserve the original defaults and key.
set -euo pipefail
umask 077
if [[ $# != 3 || ! $2 =~ ^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$ ]]; then
  printf 'Usage: bash scripts/resume-bike-runtime-plan.sh EXISTING_RUN_DIRECTORY VERIFIED_BUILD_ID REVIEWED_NUMERIC_SECRET_VERSION\n' >&2
  exit 2
fi
REPAIDO_BIKE_RECORDS=$1
REPAIDO_EXPECTED_BUILD=$2
REPAIDO_BIKE_QUOTA_VERSION=$3
REPAIDO_SCRIPT_ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$REPAIDO_SCRIPT_ROOT"
test -d "$REPAIDO_BIKE_RECORDS"
if [[ -e "$REPAIDO_BIKE_RECORDS/release" ]]; then
  printf 'STOP: A release directory already exists. Inspect its recorded state before another prepare.\n' >&2
  exit 1
fi
python3 - "$REPAIDO_BIKE_RECORDS/tools/terraform" "$REPAIDO_EXPECTED_BUILD" "$REPAIDO_BIKE_QUOTA_VERSION" <<'PY'
import hashlib, pathlib, runpy, sys
binary=pathlib.Path(sys.argv[1])
if hashlib.sha256(binary.read_bytes()).hexdigest()!='00a240950f88f51a03ad90975f1647737e40ddcd5df30a703fd840aa07dccced':
    raise SystemExit('STOP: existing Terraform binary differs from the verified package.')
setup=runpy.run_path('infra/bike-runtime/activate.py')
setup['validate_secret'](sys.argv[3])
serving,_=setup['baseline'](setup['Runner']())
if serving['build_id']!=sys.argv[2]:
    raise SystemExit('STOP: serving backend changed; inspect before resuming setup.')
print('Verified existing Terraform, serving backend and reviewed numeric key reference.')
PY
export PATH="$REPAIDO_BIKE_RECORDS/tools:$PATH"
export CHECKPOINT_DISABLE=1
gcloud auth application-default print-access-token >/dev/null
python3 infra/bike-runtime/activate.py bootstrap \
  --state-bucket repaido-bike-runtime-tfstate-133610574058 \
  --quota-secret-version "$REPAIDO_BIKE_QUOTA_VERSION" \
  --record-file "$REPAIDO_BIKE_RECORDS/bootstrap-progress.json" \
  | tee "$REPAIDO_BIKE_RECORDS/bootstrap-recovery.json"
python3 infra/bike-runtime/activate.py prepare \
  --state-bucket repaido-bike-runtime-tfstate-133610574058 \
  --quota-secret-version "$REPAIDO_BIKE_QUOTA_VERSION" \
  --maximum-workers 2 --directory "$REPAIDO_BIKE_RECORDS/release" \
  | tee "$REPAIDO_BIKE_RECORDS/preparation.json"
if [[ -f "$REPAIDO_BIKE_RECORDS/release/plan.txt" ]]; then
  cat "$REPAIDO_BIKE_RECORDS/release/plan.txt"
fi
printf '\nPlan records: %s/release. Send the complete output; the next stage deploys and verifies the workers after the saved plan is checked.\n' "$REPAIDO_BIKE_RECORDS"
