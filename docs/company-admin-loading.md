# Company admin loading

Company workspaces load their own records. A failed worker or booking request must not prevent transport reviews, shop approvals, finance, support, moderation or other tabs from mounting and fetching their data.

The overview reads workers and bookings independently. Each failed source has its own retry action, and counts remain unavailable until an actual response arrives. Bookings retain their last confirmed records during temporary server or network failures. Authentication and access denials retire private snapshots; account changes invalidate the account-scoped memory cache. Refresh actions bypass cache freshness.

Finance, refund and evidence review queues fetch on opening their tab. Refresh performs one read of each source. These reads do not save records, show save confirmations or force another Firebase token refresh. Actual decisions remain explicit, authorized mutations.

On `repaido.web.app` and `repaido.firebaseapp.com`, the default API path stays on the hosting origin. Firebase Hosting's existing `/api` rewrites forward requests to the appropriate service while preserving bearer authentication. Explicit `VITE_API_BASE_URL` configuration and the external deployment fallback still work. Server administrator authorization is unchanged.

## Validation

- `npm --prefix web test` checks hosted production routing, API deadlines and account-scoped cache retirement, alongside the existing frontend suite.
- `npm --prefix web run build` runs TypeScript and the production build.
- Start Vite with `npm --prefix web run dev -- --port 5187`, then run `PLAYWRIGHT_MODULE=<installed Playwright module> node web/tests/company-admin.browser.mjs`.

The browser test starts a disposable SQLite API using `company_admin_api.py`, exercises the real admin components and routes, injects overview outages, verifies all tabs, tests retries and account changes, and checks responsive layouts and enhanced contrast. It uses only synthetic identities and never contacts production data stores or payment providers.
