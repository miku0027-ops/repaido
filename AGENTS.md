# Development and releases

- Continue implementation and local verification without deploying.
- Deploy only when the user explicitly requests a release. A feature request,
  successful test run, or completed commit does not authorize deployment.
- Do not push to `main` or another branch that triggers a production build unless
  that release is explicitly requested. Keep unreleased changes in development.
- Batch completed changes into one or two releases per day when requested;
  this is a release limit, not an automatic deployment schedule.
- Do not enable automatic production push triggers or set their
  `_RELEASE_APPROVED` substitution to `true`.
- Prefer local checks while developing. Run the full cloud release pipeline once
  for the requested batch, and diagnose failures before resubmitting it.
- Review Cloud Build and Cloud Run costs using actual configuration and usage.
  Preserve booking, location, and notification delivery when adjusting capacity.
  Cloud Run runtime updates can create revisions and must wait for a requested
  release. Disabling an automatic build trigger does not deploy application code.

See [release instructions](docs/CLOUD_BUILD.md) and
[cost controls](docs/CLOUD_COST_CONTROLS.md).
