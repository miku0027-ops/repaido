#!/usr/bin/env bash
# Private dependencies for the explicit, native office-cash maintenance helper.
set -euo pipefail
umask 077
REPAIDO_MAINTENANCE_ENV=${1:?Supply a private Python tools directory}
shift
REPAIDO_REPO=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
if ! test -x "$REPAIDO_MAINTENANCE_ENV/bin/python"; then
  python3 -m venv "$REPAIDO_MAINTENANCE_ENV"
fi
REPAIDO_REQUIREMENTS_HASH=$(sha256sum "$REPAIDO_REPO/backend/requirements.txt" | cut -d ' ' -f 1)
if ! test -f "$REPAIDO_MAINTENANCE_ENV/requirements.sha256" ||
   test "$(cat "$REPAIDO_MAINTENANCE_ENV/requirements.sha256")" != "$REPAIDO_REQUIREMENTS_HASH"; then
  printf 'Preparing private Python dependencies; log: %s\n' "$REPAIDO_MAINTENANCE_ENV/install.log"
  if ! "$REPAIDO_MAINTENANCE_ENV/bin/python" -m pip install --disable-pip-version-check \
      -r "$REPAIDO_REPO/backend/requirements.txt" > "$REPAIDO_MAINTENANCE_ENV/install.log" 2>&1; then
    tail -n 20 "$REPAIDO_MAINTENANCE_ENV/install.log"
    exit 1
  fi
  printf '%s\n' "$REPAIDO_REQUIREMENTS_HASH" > "$REPAIDO_MAINTENANCE_ENV/requirements.sha256"
fi
exec "$REPAIDO_MAINTENANCE_ENV/bin/python" "$REPAIDO_REPO/scripts/activate-bike-office-cash.py" "$@"
