#!/usr/bin/env bash
# Reviewable Cloud Shell setup. Default is offline plan output, with no changes.
set -euo pipefail

REPAIDO_MAIL_PROJECT='repaido'
REPAIDO_MAIL_REGION='us-central1'
REPAIDO_MAIL_HOST=''
REPAIDO_MAIL_PORT='465'
REPAIDO_MAIL_USERNAME='support@repaido.com'
REPAIDO_MAIL_ORIGIN='https://repaido.web.app'
REPAIDO_MAIL_PASSWORD_SECRET='repaido-smtp-password'
REPAIDO_MAIL_CHALLENGE_SECRET='repaido-email-challenge-secret'
REPAIDO_MAIL_PASSWORD_FILE=''
REPAIDO_MAIL_APPLY='false'
REPAIDO_MAIL_ENABLE='false'
while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) REPAIDO_MAIL_PROJECT="$2"; shift 2 ;;
    --region) REPAIDO_MAIL_REGION="$2"; shift 2 ;;
    --host) REPAIDO_MAIL_HOST="$2"; shift 2 ;;
    --port) REPAIDO_MAIL_PORT="$2"; shift 2 ;;
    --username) REPAIDO_MAIL_USERNAME="$2"; shift 2 ;;
    --origin) REPAIDO_MAIL_ORIGIN="$2"; shift 2 ;;
    --password-secret) REPAIDO_MAIL_PASSWORD_SECRET="$2"; shift 2 ;;
    --challenge-secret) REPAIDO_MAIL_CHALLENGE_SECRET="$2"; shift 2 ;;
    --password-file) REPAIDO_MAIL_PASSWORD_FILE="$2"; shift 2 ;;
    --apply) REPAIDO_MAIL_APPLY='true'; shift ;;
    --enable) REPAIDO_MAIL_ENABLE='true'; shift ;;
    *) printf 'Unknown setup argument: %s\n' "$1" >&2; exit 2 ;;
  esac
done

python3 - "$REPAIDO_MAIL_PROJECT" "$REPAIDO_MAIL_REGION" "$REPAIDO_MAIL_HOST" "$REPAIDO_MAIL_PORT" "$REPAIDO_MAIL_USERNAME" "$REPAIDO_MAIL_ORIGIN" "$REPAIDO_MAIL_PASSWORD_SECRET" "$REPAIDO_MAIL_CHALLENGE_SECRET" <<'PY'
import re,sys
from urllib.parse import urlsplit
project,region,host,port,username,origin,password_secret,challenge_secret=sys.argv[1:]
assert re.fullmatch(r'[a-z][a-z0-9-]{4,61}[a-z0-9]',project),'Use a valid project ID.'
assert re.fullmatch(r'[a-z]+-[a-z]+[0-9]',region),'Use a valid Cloud Run region.'
assert re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9.\-]{0,252}',host),'Supply the provider SMTP hostname with --host.'
assert port in ('465','587'),'Choose TLS SMTP port 465 or 587.'
assert username and len(username)<=254 and not any(ord(c)<32 or c=='|' for c in username),'Use the provider SMTP login username.'
url=urlsplit(origin)
assert not any(ord(c)<32 or c=='|' for c in origin) and url.scheme=='https' and url.hostname and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9.\-]{0,252}',url.hostname) and not url.username and not url.password and url.path in ('','/') and not url.query and not url.fragment,'Use the public HTTPS app origin.'
url.port
assert all(re.fullmatch(r'[A-Za-z0-9_-]{1,255}',name) for name in (password_secret,challenge_secret)),'Use valid Secret Manager resource names.'
assert password_secret!=challenge_secret,'Use separate SMTP and challenge secrets.'
PY

printf 'Project: %s | region: %s\n' "$REPAIDO_MAIL_PROJECT" "$REPAIDO_MAIL_REGION"
printf 'TLS SMTP: %s:%s | login: %s | sender: support@repaido.com\n' "$REPAIDO_MAIL_HOST" "$REPAIDO_MAIL_PORT" "$REPAIDO_MAIL_USERNAME"
printf 'Authenticated app origin: %s\n' "$REPAIDO_MAIL_ORIGIN"
printf 'Secret references: %s and %s | requested delivery enabled: %s\n' "$REPAIDO_MAIL_PASSWORD_SECRET" "$REPAIDO_MAIL_CHALLENGE_SECRET" "$REPAIDO_MAIL_ENABLE"
if [[ "$REPAIDO_MAIL_APPLY" != 'true' ]]; then
  printf '%s\n' 'Offline plan only. --apply stores secret references/configuration; --enable separately permits the worker to attempt queued email.'
  exit 0
fi

command -v gcloud >/dev/null
umask 077
REPAIDO_MAIL_TEMP_PASSWORD=''
cleanup_mail_setup() {
  if [[ -n "$REPAIDO_MAIL_TEMP_PASSWORD" ]]; then rm -f -- "$REPAIDO_MAIL_TEMP_PASSWORD"; fi
}
trap cleanup_mail_setup EXIT
gcloud services enable secretmanager.googleapis.com --project="$REPAIDO_MAIL_PROJECT" --quiet --format=none

mail_enabled_version() {
  local REPAIDO_MAIL_VERSION_NAME
  REPAIDO_MAIL_VERSION_NAME="$(gcloud secrets versions list "$1" --project="$REPAIDO_MAIL_PROJECT" --filter='state=ENABLED' --sort-by='~createTime' --limit=1 --format='value(name)')" || return
  REPAIDO_MAIL_VERSION_NAME="${REPAIDO_MAIL_VERSION_NAME##*/}"
  if [[ -n "$REPAIDO_MAIL_VERSION_NAME" && ! "$REPAIDO_MAIL_VERSION_NAME" =~ ^[1-9][0-9]*$ ]]; then
    printf '%s\n' 'Secret Manager returned an invalid enabled version reference.' >&2
    return 2
  fi
  printf '%s' "$REPAIDO_MAIL_VERSION_NAME"
}

if ! gcloud secrets describe "$REPAIDO_MAIL_PASSWORD_SECRET" --project="$REPAIDO_MAIL_PROJECT" --quiet --format=none >/dev/null 2>&1; then
  gcloud secrets create "$REPAIDO_MAIL_PASSWORD_SECRET" --project="$REPAIDO_MAIL_PROJECT" --replication-policy=automatic --quiet --format=none
fi
REPAIDO_MAIL_EXISTING_PASSWORD_VERSION="$(mail_enabled_version "$REPAIDO_MAIL_PASSWORD_SECRET")"
if [[ -n "$REPAIDO_MAIL_PASSWORD_FILE" ]]; then
  test -s "$REPAIDO_MAIL_PASSWORD_FILE"
  gcloud secrets versions add "$REPAIDO_MAIL_PASSWORD_SECRET" --project="$REPAIDO_MAIL_PROJECT" --data-file="$REPAIDO_MAIL_PASSWORD_FILE" --quiet --format=none
elif [[ -z "$REPAIDO_MAIL_EXISTING_PASSWORD_VERSION" ]]; then
  if [[ ! -t 0 ]]; then
    printf '%s\n' 'Supply an existing Secret Manager password version or a private --password-file. No credential is accepted as a command argument.' >&2
    exit 2
  fi
  REPAIDO_MAIL_TEMP_PASSWORD="$(mktemp /tmp/repaido-smtp-password.XXXXXX)"
  IFS= read -r -s -p 'SMTP app password (hidden): ' REPAIDO_MAIL_PRIVATE_PASSWORD
  printf '\n'
  test -n "$REPAIDO_MAIL_PRIVATE_PASSWORD"
  printf '%s' "$REPAIDO_MAIL_PRIVATE_PASSWORD" > "$REPAIDO_MAIL_TEMP_PASSWORD"
  unset REPAIDO_MAIL_PRIVATE_PASSWORD
  gcloud secrets versions add "$REPAIDO_MAIL_PASSWORD_SECRET" --project="$REPAIDO_MAIL_PROJECT" --data-file="$REPAIDO_MAIL_TEMP_PASSWORD" --quiet --format=none
  rm -f -- "$REPAIDO_MAIL_TEMP_PASSWORD"; REPAIDO_MAIL_TEMP_PASSWORD=''
fi

if ! gcloud secrets describe "$REPAIDO_MAIL_CHALLENGE_SECRET" --project="$REPAIDO_MAIL_PROJECT" --quiet --format=none >/dev/null 2>&1; then
  gcloud secrets create "$REPAIDO_MAIL_CHALLENGE_SECRET" --project="$REPAIDO_MAIL_PROJECT" --replication-policy=automatic --quiet --format=none
fi
REPAIDO_MAIL_EXISTING_CHALLENGE_VERSION="$(mail_enabled_version "$REPAIDO_MAIL_CHALLENGE_SECRET")"
if [[ -z "$REPAIDO_MAIL_EXISTING_CHALLENGE_VERSION" ]]; then
  python3 -c 'import secrets,sys;sys.stdout.write(secrets.token_urlsafe(48))' |
    gcloud secrets versions add "$REPAIDO_MAIL_CHALLENGE_SECRET" --project="$REPAIDO_MAIL_PROJECT" --data-file=- --quiet --format=none
fi

# Pin actual enabled versions; :latest may point to a disabled newer version.
REPAIDO_MAIL_PASSWORD_VERSION="$(mail_enabled_version "$REPAIDO_MAIL_PASSWORD_SECRET")"
REPAIDO_MAIL_CHALLENGE_VERSION="$(mail_enabled_version "$REPAIDO_MAIL_CHALLENGE_SECRET")"
test -n "$REPAIDO_MAIL_PASSWORD_VERSION"
test -n "$REPAIDO_MAIL_CHALLENGE_VERSION"

for REPAIDO_MAIL_SERVICE in repaido-api repaido-work-worker; do
  REPAIDO_MAIL_RUNTIME="$(gcloud run services describe "$REPAIDO_MAIL_SERVICE" --project="$REPAIDO_MAIL_PROJECT" --region="$REPAIDO_MAIL_REGION" --format='value(spec.template.spec.serviceAccountName)')"
  test -n "$REPAIDO_MAIL_RUNTIME"
  for REPAIDO_MAIL_SECRET in "$REPAIDO_MAIL_PASSWORD_SECRET" "$REPAIDO_MAIL_CHALLENGE_SECRET"; do
    gcloud secrets add-iam-policy-binding "$REPAIDO_MAIL_SECRET" --project="$REPAIDO_MAIL_PROJECT" \
      --member="serviceAccount:$REPAIDO_MAIL_RUNTIME" --role=roles/secretmanager.secretAccessor --condition=None --quiet --format=none
  done
  # Use a custom delimiter so metadata values do not become extra assignments.
  gcloud run services update "$REPAIDO_MAIL_SERVICE" --project="$REPAIDO_MAIL_PROJECT" --region="$REPAIDO_MAIL_REGION" \
    --update-env-vars="^|^REPAIDO_TRANSACTIONAL_EMAIL_ENABLED=$REPAIDO_MAIL_ENABLE|REPAIDO_SMTP_HOST=$REPAIDO_MAIL_HOST|REPAIDO_SMTP_PORT=$REPAIDO_MAIL_PORT|REPAIDO_SMTP_USERNAME=$REPAIDO_MAIL_USERNAME|REPAIDO_SMTP_FROM=support@repaido.com|REPAIDO_PUBLIC_WEB_URL=$REPAIDO_MAIL_ORIGIN" \
    --update-secrets="REPAIDO_SMTP_PASSWORD=$REPAIDO_MAIL_PASSWORD_SECRET:$REPAIDO_MAIL_PASSWORD_VERSION,REPAIDO_EMAIL_CHALLENGE_SECRET=$REPAIDO_MAIL_CHALLENGE_SECRET:$REPAIDO_MAIL_CHALLENGE_VERSION" --quiet --format=none
done
printf '%s\n' 'Secret references and TLS SMTP metadata configured. SMTP acceptance, provider mailbox delivery and domain SPF/DKIM/DMARC require separate verification.'
