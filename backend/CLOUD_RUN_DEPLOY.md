# Production deployment

The API now uses Firestore operational transactions in production, private Cloud Storage verification documents, and an authenticated Cloud Scheduler endpoint. Read [the current runbook](../deployment/PRODUCTION_RUNBOOK.md) and use [the production environment configuration](../deployment/production-env.yaml).

Deploy a no-traffic candidate first:

```sh
gcloud run deploy repaido-api --project repaido --region us-central1 \
  --source backend --service-account=repaido-runtime@repaido.iam.gserviceaccount.com \
  --env-vars-file=deployment/production-env.yaml --no-traffic --tag=integration-review
```

Do not place secrets on the command line or enable provider flags before account activation, secret mounting, webhook setup and validation. Legacy SQLite tables remain for local development and compatibility; financial operations use Firestore, not Cloud Run ephemeral storage.
