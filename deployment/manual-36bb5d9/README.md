# Manual Cloud Shell deployment for release 36bb5d9

These helpers deploy the fixed application commit `36bb5d925305ab4046e08d4dae7372058b1c0a41`, not the helper branch HEAD. They require only Python 3 standard library, Git and the existing signed-in gcloud CLI. No ZIP upload, extra Python package or shared credential is required.

Copy this folder outside the source checkout before checking out the fixed application commit. Run `python3 prepare.py /path/to/clean/source`, then `python3 deploy.py --check-package` for an offline check, then `python3 deploy.py` to deploy. Source bytes, complete archive inventory and build config are checked against the original reviewed manifest; gzip byte differences across tool versions are permitted only when the full unpacked content is identical.

The runner checks the live baseline and active builds, saves rollback traffic/scheduler metadata, uploads one pinned source generation and submits one explicitly approved build. The three additive indexes must be READY before API promotion. Rules and Firebase Hosting are unchanged. The runner never publishes the cPanel website. Send its final SUCCESS/error and Build ID to Codex to finish the staged website after live API verification.

Do not rerun if the command stops after submission or the terminal disconnects. Keep `submission.json` and `rollback-metadata`; a request timeout may hide an accepted build. Do not delete the submission record or use a fresh runner folder to force a retry. Check the existing Build ID/history first. Automatic rollback is not provided by the original API pipeline; share any failure before another attempt.

Preparation and integrity checks have been tested locally. Cloud submission from this wrapper remains unexecuted locally because the environment's GCP credential fails. Read INDEX_RELEASE.md for exact source/config hashes and deployment/rollback gates. Do not print, save or share tokens in chat.

The runner explicitly enables Docker BuildKit for the optional proxy CA secret mount. Standard cloudbuild.yaml and generated cloudbuild-api.yaml also enable it; production builds can omit that optional CA.
