# Production website on cPanel

`repaido.com` is the customer, worker, contractor, shop and company-admin website.
cPanel serves its static production build. Cloud Run continues serving the
authenticated APIs, Firestore records, private media and background delivery;
cPanel is not configured to run the Python API or store its databases.

The confirmed account is `repaidoc` on `cpanel.repaido.com`. Its account home is
`/home/repaidoc`; that is not sufficient evidence of the site's document root.
Read **cPanel → Domains → repaido.com → Document Root**, or run
`python3 scripts/check-cpanel-access.py` with the securely configured
`CPANEL_API_TOKEN`. This uses read-only domain metadata. Do not reuse a browser
session URL as a deployment credential or put a token in source, chat or scripts.

## Release sequence

1. Commit and review the complete release; run the relevant backend/frontend
   tests and browser checks. Confirm no pending source changes.
2. Verify the actual deployed API baseline at
   `https://repaido.web.app/build-info.json` and `/api/health`. The October 14
   preflight found commit `b421e09592a7af292e6020ab54f1e6446b83f0b3` and build
   `4d2d4a26-37db-4625-a87e-48636603cafa`. This is a point-in-time observation.
3. From an authenticated Cloud Shell checkout of the reviewed commit, run:

   ```bash
   bash scripts/release-cpanel-backend.sh --release FULL_REVIEWED_SHA \
     --changed-from ACTUAL_DEPLOYED_API_SHA
   ```

   This runs the existing API-only Cloud Build pipeline once: tests, one image,
   no-traffic candidates, health/storage checks and promotion of the main API,
   work API and private delivery worker. It changes neither Firebase Hosting nor
   cPanel and enables no automatic trigger. The helper refuses an active build,
   an unreviewed/dirty checkout, or an unhandled Rules/index change. API-only
   release means the Firebase website's build ID stays on its previous release;
   do not use its unchanged commit as the API baseline for future releases.
4. Build the independently versioned website archive locally:

   ```bash
   python3 scripts/package-cpanel-release.py --release FULL_REVIEWED_SHA \
     --output /tmp/repaido-cpanel-FULL_REVIEWED_SHA.zip
   ```

   It runs TypeScript and Vite's cPanel build with explicit main/work origins,
   confirms those origins reached the JavaScript, adds Apache configuration and
   release metadata, sets public files/folders to `0644`/`0755`, checks the archive,
   and writes a separate SHA-256 manifest.
   It uploads nothing. Its ZIP contains website files at the archive root;
   there is no enclosing `dist-cpanel` folder. Existing published APK downloads
   are included unchanged; this release does not build new native APKs.
5. Before upload, save a recoverable backup of the existing website files,
   including `.htaccess`, outside the public document root. Keep mail, account
   configuration, `.well-known`, unrelated applications and user uploads.
   Upload and extract the ZIP into a staging directory outside the public
   document root. Remove the uploaded archive after extraction.
6. Publish built asset files and public resources into the verified document
   root first. Keep the preceding release's hashed assets for open sessions and
   rollback. Preserve the site's existing HTTPS redirect/provider directives
   when applying the supplied `.htaccess`. Publish `index.html` and
   `build-info.json` last. Do not extract to `/home/repaidoc` and assume that
   publishes the website; do not upload the repository or `.env` files.
7. Run the read-only production check using the actual successful API build ID:

   ```bash
   python3 scripts/verify-cpanel-release.py --release FULL_REVIEWED_SHA \
     --api-build SUCCESSFUL_CLOUD_BUILD_ID
   ```

   It verifies the website source identity, direct SPA navigation, assets,
   missing-asset 404s, both API identities, browser CORS and guest denial on
   authenticated tools/preferences. These checks do not prove signed-in account,
   payment or push flows; test those separately using approved test accounts.

## Routing, cache and sign-in

The cPanel build sends main requests to
`https://repaido-api-133610574058.us-central1.run.app`. Work, company and placement
requests use `https://repaido-work-api-133610574058.us-central1.run.app`, matching
the existing Firebase Hosting service boundary. Each API validates identity and
allows the exact `https://repaido.com` and `https://www.repaido.com` origins.
The private delivery worker remains inaccessible to the website.

Apache serves `index.html` for the application's direct routes, returns 404 for
missing assets, disables directory listings and sets the existing security
headers. HTML, release metadata and the push service worker revalidate; hashed
JavaScript/CSS can cache for a year. Firebase Authentication must include both
production domains in its authorized domains. A cPanel archive cannot grant that
provider setting. Keep HTTPS on the domain for geolocation and browser push.

## Website-only repairs

When a fix changes only browser code, reuse the already verified compatible API
build. Pass its source commit separately so the website metadata records both
versions accurately:

```bash
python3 scripts/package-cpanel-release.py --release REVIEWED_WEBSITE_SHA \
  --required-api-commit EXISTING_COMPATIBLE_API_SHA \
  --output /tmp/repaido-cpanel-REVIEWED_WEBSITE_SHA.zip
```

After the requested release is authorized, follow the same backup, staging,
asset-first publication and live checks. A website-only repair requires no
Cloud Build submission or Cloud Run revision. Keep the current Apache provider
configuration and publish only changed resources plus the entry and metadata.

The Repaidians transport uses the same API origin resolver for feed, media,
network and work requests. Do not use raw same-origin `/api` fetches: cPanel
deliberately returns 404 for those paths. Exercise the browser suite with explicit
main/work origins so its forwarding cannot hide an incorrect client URL:

```bash
# Start the Vite preview in a separate terminal (not a production deployment).
VITE_API_BASE_URL=https://repaido-api-133610574058.us-central1.run.app \
VITE_WORK_API_BASE_URL=https://repaido-work-api-133610574058.us-central1.run.app \
npm --prefix web run dev -- --port 5186

# The suite redirects only correctly routed calls into its isolated SQLite API.
# PLAYWRIGHT_MODULE may point to the environment's existing Playwright package.
cd web
REPAIDIANS_PREVIEW_ORIGIN=http://127.0.0.1:5186 \
REPAIDIANS_EXPECTED_MAIN_ORIGIN=https://repaido-api-133610574058.us-central1.run.app \
REPAIDIANS_EXPECTED_WORK_ORIGIN=https://repaido-work-api-133610574058.us-central1.run.app \
node tests/repaidians.browser.mjs
```

Also open Repaidians in the actual cPanel production bundle, check that bootstrap
returns JSON from the main API, and verify the feed and error/retry states.
Website metadata, catalog checks and the home screen alone cannot verify this.

## Rollback and cost

Record the prior main/work/worker revisions and retain the website backup before
promotion. Cloud Build health failures prevent candidate promotion; failures
after promotion do not automatically restore earlier traffic. Restore the prior
compatible website and API revisions together when necessary. Static publication
does not migrate records or rules. Keep old hashed assets until older sessions
have ended, then remove only artifacts recorded in the release manifests.

This cPanel release avoids a second Vite build in Cloud Build, Firebase Hosting
publication and unchanged Rules writes. It uses one API build for the shared
backend image. Optional community splitting and Cloud Tasks event wakeups remain
disabled unless their existing runtime configuration explicitly enables them;
this release does not create another always-on service, queue or trigger.
