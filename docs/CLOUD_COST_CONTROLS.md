# Cloud costs and manual releases

Application work stays in development until the user asks for a release. Batch
changes into one or two requested releases per day. Do not schedule automatic
daily releases or push development commits to a production deployment branch.

## Stop automatic builds

Disable the existing production push trigger in
[Cloud Build Triggers](https://console.cloud.google.com/cloud-build/triggers?project=repaido).
Check both `global` and `us-central1` if the trigger is not listed. Disabling a
trigger prevents future automatic builds; it does not deploy, stop the app, or
cancel a build already running. Do not disable unrelated triggers.

The repository's first build step also refuses a release unless
`_RELEASE_APPROVED=true` and a full commit SHA are explicitly supplied. Keep the
override **false on triggers**. This is a fallback: an enabled trigger still
starts a short failed build. Disabling the trigger avoids that build cost too.
Local repository changes do not update the live trigger or its configuration.

From an authenticated Cloud Shell checkout containing these scripts, inspect:

```sh
python3 scripts/cloud-cost-controls.py audit --project=repaido
```

The audit reads triggers and the latest 20 builds in `global` and `us-central1`,
Run services and Scheduler jobs in `us-central1`. Specify `--build-location`
repeatedly or `--region` for other locations. It prints only configuration and
release metadata, not environment values or credentials. It does not inspect
every region or calculate billing totals.

Identify the production trigger, then preview disabling that exact trigger:

```sh
python3 scripts/cloud-cost-controls.py disable-trigger \
  --project=repaido --location=global --trigger=PRODUCTION_TRIGGER_ID
```

Add `--apply` to disable it. The helper patches only `disabled`, then reads the
trigger again to verify. It never submits a build or updates Cloud Run. Repeated
execution skips an already disabled trigger. The account needs Cloud Build
trigger read/update permission. Access tokens stay in process memory.

## Review running costs before changing capacity

Use [Billing Reports](https://console.cloud.google.com/billing?project=repaido)
to compare Cloud Build, Cloud Run, Artifact Registry, Firestore, and network
charges over the same period. Fewer releases reduce build work; Cloud Run also
charges for application usage between releases. No savings amount is established
without billing data.

Use the component-scoped manual release in [Cloud Build deployment](CLOUD_BUILD.md#component-scoped-releases)
when a reviewed change affects only Hosting, API, or Firestore Rules. This skips
unrelated test/build/deploy steps and, for a web or Rules change, avoids new
Cloud Run revisions. Cloud Build still runs and uploads the current root source
inventory; measure the next selective build before estimating savings. The
engineering console already has a separate release workflow. Do not add
automatic per-commit production triggers.

The deployment source sets zero minimum instances for `repaido-work-api` and
`repaido-work-worker`, with maximums of 20 and 2. The main API preserves its existing
scaling and billing settings. Audit the actual deployed configuration rather than
assuming it matches these defaults.

- Check service and revision minimum instances, CPU billing, and tagged old
  revisions. Retained revisions alone do not prove running instance charges.
- Consider zero minimum instances and request-based billing where cold starts
  and request-bound processing are acceptable. Runtime updates can create a
  revision, so include reviewed changes in the next requested release.
- Set maximum instances using peak request volume, latency, and queue behavior.
  A maximum is a capacity bound, not idle instance usage; reducing it arbitrarily
  can make the app unavailable under load.
- Keep scheduled booking reminders, journey safety checks, and notification
  delivery running. Review schedule frequency with their timing requirements.
- Review Artifact Registry image retention and logs with rollback and debugging
  needs before applying a cleanup policy. Do not remove the serving image.

The audit intentionally does not change scaling, CPU settings, traffic, schedules,
image retention, billing alerts, IAM, or application data. Apply each reviewed
infrastructure change only with access to the correct project and its current
configuration. See [the release workflow](CLOUD_BUILD.md) for the manual batch.
