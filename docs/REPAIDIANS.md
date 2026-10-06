# Repaidians community

The Home launcher opens Repaidians without resetting customer location, navigation or booking state. Its interface uses a photo-first social feed, gradient story rings, compact actions, a mobile tab bar and a desktop side rail. Light and dark themes share the Repaido design tokens. Motion respects the device's reduced-motion preference.

## Shared backend

`web/src/services/repaidiansService.ts` calls the same-origin `/api/repaidians` API. Firebase ID tokens, or development SQLite session tokens, identify the current member. Account IDs passed by a component never establish ownership. The backend owns the publication, media, membership and access rules.

Community records use the existing operations store: Firestore `ops_rp_*` collections in the cloud and `operation_records` in SQLite for local development. Records include members, publications, timelines, comments, likes, saves, follows, messages and threads, tenders and bids, notifications, reports, blocks, usage and billing attempts. Indexed timeline lanes, prefix member search and cursors bound reads per request; followers and engagement counters update in the same transaction as their actions.

The application does not generate sample posts, seeded tenders, fake engagement or invented specialist work. A new community starts with an empty feed. Registered members can create their own profile and portfolio. Reviewed work indicators are derived from approved Repaido worker records. Old `repaidians.v1.*` browser data and demo subscriptions are ignored rather than promoted to paid or public records.

## Features and access

- Public or same-trade photo posts, carousels, likes, comments, saved items and a Following feed.
- Photo/video stories that expire 24 hours after publication, with progress, pause, navigation and replies.
- Uploaded work reels with playback/audio controls and the existing service booking handoff.
- Member search, portfolio profiles, follows, shared message threads and activity notifications.
- Tender briefs with budget, deadline, crew size, persisted bids and separately protected contact details.
- Owner-only publication deletion, reporting and bilateral blocking. Blocks also remove follow relationships and hide affected publications, threads and notifications. Operator-authenticated `/api/repaidians/admin/reports` and `/api/repaidians/admin/reports/{id}/resolve` routes support reasoned review decisions and removal; this release has no dedicated moderation dashboard.
- Server-measured 15-minute daily browsing allowance for free members and guests, resetting at midnight in India. Content reads and foreground heartbeats acquire shared 15-second leases, charged by the server; pausing stops renewal and an unused slice is not refunded. Account or HTTP-only guest-cookie records deduplicate overlapping browser sessions. The guest cookie uses Firebase Hosting's supported `__session` name. The backend gates content after the allowance is exhausted.
- Active Repaidians Pro is required to publish posts, stories or reels, upload work videos, submit bids, reveal tender contacts or send messages. Free authenticated members can browse and interact during their allowance; receiving existing messages does not require the recipient to buy Pro.

## Media storage

Uploads go to authenticated API routes, not LocalStorage or IndexedDB. The backend checks ownership, MIME/container signatures, size and access before serving private bytes. Images are normalized to remove metadata. Supported Pro publication formats are JPG, PNG, WebP, MP4 and WebM, up to 8 MB per file. Free members can upload a profile photo up to 2 MB; this does not allow publication or video upload.

Cloud storage uses `REPAIDO_COMMUNITY_BUCKET`, with the existing private `REPAIDO_KYC_BUCKET` as a fallback under a separate `repaidians/` prefix. Cloud/Firestore deployments fail closed if no durable bucket is configured. SQLite development stores media beside the database or in `REPAIDO_COMMUNITY_MEDIA_DIR`. The frontend keeps a bounded, identity-scoped in-memory cache of protected media and does not persist private copies on the device.

## Membership and billing

Pro costs ₹199 for one calendar month. It is a one-time Razorpay checkout with manual renewal, not an automatic recurring charge. The backend creates the INR 19,900-paise order. A browser payment callback does not grant access: the backend fetches the provider order/payment and verifies ownership, amount, currency and captured status before recording entitlement. Idempotent reconciliation and signed webhook processing prevent duplicate grants and remove refunded periods without deleting unrelated paid months.

Configure `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` in backend secrets and explicitly set `REPAIDO_PAYMENTS_ENABLED=true` to enable checkout. The existing `/api/operations/webhooks/razorpay/payments` webhook also reconciles community payments; `/api/repaidians/webhooks/razorpay` is available as a dedicated alternative. When gateway credentials or payment activation are unavailable, payment readiness is false and checkout remains unavailable. There is no simulated purchase or browser-controlled Pro activation.

## Validation and operational limits

From `web/`, run `npm test`, `npx tsc --noEmit` and `npm run build`. The service contract tests cover session authority, credential boundaries, read deduplication, account isolation, retry/idempotency behavior and protected media caching.

`web/tests/repaidians.browser.mjs` starts its own isolated SQLite backend at port 8019 and uses the Vite preview at port 5187. Start the preview with `npm run dev -- --port 5187 --strictPort`, then run `node tests/repaidians.browser.mjs`. The suite creates test accounts through the real registration API, grants membership only in the isolated test database and performs uploads/social actions against real API routes. It never intercepts community responses with mock feed or entitlement data. It checks cross-session persistence, owner/visibility boundaries, free-avatar and Pro upload limits, mobile/desktop layout, themes, reduced motion, enlarged text and accessibility. It needs `ffmpeg` for a small test video; set `PLAYWRIGHT_MODULE` and `CHROME_PATH` if Playwright or Chromium is not on the default path.

Messages and activity refresh through API reads; this release does not add WebSocket delivery, push notifications, automated content moderation, video transcoding or adaptive streaming. Reports persist for authenticated operator review. Bounded indexes and cursors provide a scaling foundation; a million-user capacity claim still requires production load testing and monitoring.
