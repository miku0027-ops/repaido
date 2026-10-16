# Mobile listings and photo discovery

The billing policy described in this earlier batch is superseded by [Marketplace messaging and shared access](MARKETPLACE_MESSAGING_ACCESS.md): one shared 90-day trial, then ₹99 per calendar month, with no new percentage listing fee.

Development batch: `development/market-listing-discovery`. This batch does not deploy or change API contracts, database schemas, listing fees, payment providers, eligibility rules or infrastructure.

## Used-item and exchange editor

The listing modal uses four stages: **Item → Condition → Photo & location → Review**. It retains all existing listing fields, exchange requirements and server validation. Compact Poppins typography, pinned progress/actions, photo preview, field-specific errors and a review summary replace the long single-page form. Interactive targets remain at least 44 CSS pixels. Light/dark themes, keyboard focus, reduced motion and enlarged text are supported.

Draft details are scoped to the current Firebase UID and marketplace mode in browser-tab session storage. Selected image bytes stay in page memory; a reload requires the user to choose a local image again unless the server already acknowledged an upload. Drafts are unfinished form state, not published listings. Closing/reopening the form retains its state. Changing accounts cannot display another account's draft or private listings.

An explicit **Sign in to submit** action can carry a guest draft and selected photo into the authenticated editor. This clears consent and server upload/request references. An existing account draft is preserved and the guest item is queued behind it. Closing or returning from dismissed sign-in cancels this one-time handoff. Ordinary account switches never claim a guest draft.

Photos remain JPG/PNG, nonempty and at most 5 MiB; the native upload endpoint also validates their actual content. The item location requires an explicitly confirmed, valid coordinate pair. A default map centre is never silently submitted as the item's location. Location metadata is removed from the create command.

Before submission, the editor stores the exact create command and its request ID. If a response is lost or ambiguous, **Retry confirmation** resends that command with the same ID and acknowledged photo instead of creating another intent. Fields stay locked until confirmation. The exact uncertain command survives closing/reopening and tab reload. Later errors, including expired authentication, do not retire an already uncertain request. **Check My listings** offers an independent view of saved records. Closing/account changes cancel active requests and ignore late UI callbacks.

Free-period and payment copy describes existing server policy: the first eligible exchange listing has 30 free days; eligible second-hand listings share the seller's existing 90-day period. Submission can save a private listing that requires payment. The UI never promises a fresh 90-day period for every listing, creates an automatic charge, or claims expired replayed listings are newly published.

## Cache and loading fixes

`marketplaceReads.ts` maintains separate bounded in-memory read caches:

| Data | Freshness | Key / boundary |
| --- | --- | --- |
| Public search | 30 seconds; at most 32 keys | Mode, exact latitude/longitude, radius and submitted query |
| My listings | 15 seconds; at most 8 keys | Firebase UID; invalidated on account change |

Warm views reuse confirmed snapshots. Mutations and manual refresh invalidate pending and completed reads before reloading. Existing foreground-only 60-second background refresh remains. Rendered rows are gated by account, mode, public/private view and submitted search identity, so an old response cannot flash private records into public browse or another account.

Only canonical search/read responses populate these caches. Raw create responses contain owner fields and are never inserted into the public cache. HTTP status remains attached to read failures, allowing inaccessible results to be cleared. Nearby browsing starts only after a passed or previously confirmed search area is available.

Shared modal scroll locking now handles nested dialogs closing in either order. An account change while the item map is open no longer leaves body/root scrolling permanently disabled. Focus restoration respects any remaining dialog.

## Quick discovery

Home discovery uses relevant existing service photography in a compact horizontal repair-category rail. Market cards use existing refurbished, used-item and rental photos. Decorative photography is separate from live inventory and professional records; it does not imply pictured people or products are available. Existing booking, hiring and marketplace callbacks remain intact.

The three discovery families retain their mounted drafts and warm results when switching. Controls have compact labels and restrained motion, with reduced-motion support. Live repair results validate response structure before entering the cache. A malformed successful response produces a retry state rather than a component crash. A failed refresh may retain validated results for the same request for up to five minutes, labelled **Earlier results**; account, location, category and role changes cannot reuse those results.

## Local verification

- `cd web && npm test` covers draft validation, price units, strict coordinates, photo limits, uncertain-command persistence, explicit guest handoff and nested scroll-lock release order, alongside existing frontend regression tests.
- `cd backend && .venv/bin/pytest -q test_marketplace.py test_discovery.py` exercises existing marketplace/discovery API behavior.
- `web/tests/market-discovery.browser.mjs` uses a disposable native SQLite API with synthetic auth and local image storage. It exercises private/public boundaries, warm cache reuse, account switches, a delayed stale read during a real mutation, native photo upload, a lost reply after a real commit, exact replay, guest sign-in/cancellation and malformed discovery recovery.
- `web/tests/market-listing-layout.browser.mjs` checks both listing modes and all stages across mobile/desktop, themes and enlarged text with axe.
- `web/tests/elastic-home.browser.mjs` checks existing discovery hydration, races, routes, drafts, account/location isolation, keyboard behavior and real booking callbacks.
- `cd web && npm run build:cpanel` type-checks and produces the local cPanel build. It does not publish it.

These local fixtures do not measure production latency, real Firebase sign-in or storage availability. Production release remains a separate explicitly requested batch.
