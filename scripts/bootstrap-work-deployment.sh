#!/usr/bin/env bash
# One-time project-owner setup in Cloud Shell for the reviewed work deployment.
# Run manually; the build does not grant itself project permissions.
set -euo pipefail

REPAIDO_PROJECT_ID="${1:-repaido}"
REPAIDO_BUILD_ACCOUNT="${2:-firebase-adminsdk-fbsvc@${REPAIDO_PROJECT_ID}.iam.gserviceaccount.com}"
REPAIDO_WORK_CALLER="repaido-work-scheduler@${REPAIDO_PROJECT_ID}.iam.gserviceaccount.com"

for REPAIDO_DEPLOY_ROLE in roles/cloudbuild.builds.viewer roles/run.admin roles/cloudscheduler.admin roles/datastore.indexAdmin; do
  gcloud projects add-iam-policy-binding "$REPAIDO_PROJECT_ID" \
    --member="serviceAccount:$REPAIDO_BUILD_ACCOUNT" --role="$REPAIDO_DEPLOY_ROLE" \
    --condition=None --quiet --format=none
done

gcloud services enable cloudscheduler.googleapis.com fcm.googleapis.com \
  fcmregistrations.googleapis.com firebaseinstallations.googleapis.com \
  --project="$REPAIDO_PROJECT_ID" --quiet

REPAIDO_EXISTING_CALLER="$(gcloud iam service-accounts list --project="$REPAIDO_PROJECT_ID" \
  --filter="email=$REPAIDO_WORK_CALLER" --format='value(email)')"
if [[ -z "$REPAIDO_EXISTING_CALLER" ]]; then
  gcloud iam service-accounts create repaido-work-scheduler \
    --project="$REPAIDO_PROJECT_ID" --display-name='Repaido work update scheduler' --quiet
fi

gcloud iam service-accounts add-iam-policy-binding "$REPAIDO_WORK_CALLER" \
  --project="$REPAIDO_PROJECT_ID" --member="serviceAccount:$REPAIDO_BUILD_ACCOUNT" \
  --role=roles/iam.serviceAccountUser --condition=None --quiet --format=none

REPAIDO_RUNTIME_ACCOUNT="$(gcloud run services describe repaido-api \
  --project="$REPAIDO_PROJECT_ID" --region=us-central1 \
  --format='value(spec.template.spec.serviceAccountName)')"
test -n "$REPAIDO_RUNTIME_ACCOUNT"
# The current build identity already carries firebase.sdkAdminServiceAgent,
# which includes cloudmessaging.messages.create. A separate runtime still needs
# the same required send capability for opted-in notification delivery.
if [[ "$REPAIDO_RUNTIME_ACCOUNT" != "$REPAIDO_BUILD_ACCOUNT" ]]; then
  gcloud projects add-iam-policy-binding "$REPAIDO_PROJECT_ID" \
    --member="serviceAccount:$REPAIDO_RUNTIME_ACCOUNT" \
    --role=roles/firebasecloudmessaging.admin --condition=None --quiet --format=none
fi

gcloud projects get-iam-policy "$REPAIDO_PROJECT_ID" --flatten='bindings[].members' \
  --filter="bindings.members:$REPAIDO_BUILD_ACCOUNT" \
  --format='table(bindings.role,bindings.condition.expression)'
