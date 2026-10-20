#!/usr/bin/env bash
# Requested launch preparation only: defaults, prerequisite APIs/state/key, saved plan.
# Does not apply a worker plan, change API traffic, or enable bike bookings.
set -euo pipefail
umask 077

if [[ $# != 1 || ! $1 =~ ^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$ ]]; then
  printf 'Usage: bash scripts/prepare-bike-runtime-plan.sh VERIFIED_SERVING_BUILD_ID\n' >&2
  exit 2
fi
REPAIDO_EXPECTED_BUILD=$1
REPAIDO_SCRIPT_ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$REPAIDO_SCRIPT_ROOT"
REPAIDO_BIKE_RECORDS=$(mktemp -d "$HOME/repaido-bike-runtime-setup.XXXXXX")
printf 'Keep these setup records: %s\n' "$REPAIDO_BIKE_RECORDS"

python3 - "$REPAIDO_EXPECTED_BUILD" <<'PY'
import runpy, sys
setup = runpy.run_path('infra/bike-runtime/activate.py')
serving, _ = setup['baseline'](setup['Runner']())
if serving['build_id'] != sys.argv[1]:
    raise SystemExit('STOP: serving backend changed; inspect the release before setup.')
print('Verified single serving backend:', serving['build_id'], serving['revision'])
PY
gcloud auth application-default print-access-token >/dev/null

# The Cloud Shell terraform command may be an installation shim. Install one
# verified official binary privately for this run; never edit system packages.
python3 - "$REPAIDO_BIKE_RECORDS" <<'PY'
import hashlib, json, os, pathlib, platform, sys, urllib.request, zipfile, io
if platform.system() != 'Linux' or platform.machine() not in ('x86_64', 'amd64'):
    raise SystemExit('STOP: this reviewed Terraform package requires Linux amd64.')
url = 'https://releases.hashicorp.com/terraform/1.16.6/terraform_1.16.6_linux_amd64.zip'
expected = '38034b38d03096399a7a1264a14561a8029b2b496fd1f169452656e53968f1b7'
with urllib.request.urlopen(url, timeout=120) as response:
    payload = response.read(128*1024*1024+1)
if len(payload) > 128*1024*1024 or hashlib.sha256(payload).hexdigest() != expected:
    raise SystemExit('STOP: official Terraform archive checksum does not match.')
with zipfile.ZipFile(io.BytesIO(payload)) as archive:
    if archive.getinfo('terraform').file_size > 256*1024*1024:
        raise SystemExit('STOP: unexpected Terraform binary size.')
    binary = archive.read('terraform')
if hashlib.sha256(binary).hexdigest() != '00a240950f88f51a03ad90975f1647737e40ddcd5df30a703fd840aa07dccced':
    raise SystemExit('STOP: Terraform binary checksum does not match.')
root = pathlib.Path(sys.argv[1]); tools = root/'tools'; tools.mkdir(mode=0o700)
target = tools/'terraform'; target.write_bytes(binary); target.chmod(0o700)
(root/'terraform-download.json').write_text(json.dumps({'version':'1.16.6','archive_sha256':expected,'source':url},indent=2)+'\n')
print('Official Terraform 1.16.6 archive and binary checksums verified.')
PY
export PATH="$REPAIDO_BIKE_RECORDS/tools:$PATH"
export CHECKPOINT_DISABLE=1
terraform version

# Explicitly requested editable defaults. Existing centre/payroll are preserved;
# a new centre is pending review, and the salary template has no funded roster.
python3 scripts/configure-bike-launch-defaults.py --apply | tee "$REPAIDO_BIKE_RECORDS/defaults.json"

python3 infra/bike-runtime/activate.py bootstrap \
  --state-bucket repaido-bike-runtime-tfstate-133610574058 \
  --record-file "$REPAIDO_BIKE_RECORDS/bootstrap-progress.json" \
  | tee "$REPAIDO_BIKE_RECORDS/bootstrap.json"
REPAIDO_BIKE_QUOTA_VERSION=$(python3 - "$REPAIDO_BIKE_RECORDS/bootstrap.json" <<'PY'
import json, re, sys
value = json.load(open(sys.argv[1]))['quota_secret_version']
if not re.fullmatch(r'projects/repaido/secrets/[A-Za-z0-9_-]+/versions/[1-9][0-9]*', value):
    raise SystemExit('STOP: bootstrap did not provide a pinned numeric key version.')
print(value)
PY
)
python3 infra/bike-runtime/activate.py prepare \
  --state-bucket repaido-bike-runtime-tfstate-133610574058 \
  --quota-secret-version "$REPAIDO_BIKE_QUOTA_VERSION" \
  --maximum-workers 2 --directory "$REPAIDO_BIKE_RECORDS/release" \
  | tee "$REPAIDO_BIKE_RECORDS/preparation.json"

if [[ -f "$REPAIDO_BIKE_RECORDS/release/plan.txt" ]]; then
  cat "$REPAIDO_BIKE_RECORDS/release/plan.txt"
fi
printf '\nSend the complete output and retain %s. No workers were started, API traffic changed, or bookings enabled.\n' "$REPAIDO_BIKE_RECORDS"
