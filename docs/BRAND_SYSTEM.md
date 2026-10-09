# Repaido interface system

The shared rules live in `web/src/brand-system.css`, imported by `design-system.css`.
The priority CSS layer deliberately protects typography, surface colours and card
spacing from legacy module styles and lazy-loaded stylesheets. Module CSS still
owns layout and domain-specific states. New components should use the shared tokens,
not add another colour or spacing override.

## Card patterns

The ten supplied SVG reference sheets inform four reusable patterns, rather than
introducing a separate component for every wireframe:

| Pattern | Structure | Used for |
| --- | --- | --- |
| Identity | Avatar, name, secondary facts, status | Account and professional profiles |
| Media | Image, title, facts, price, action row | Marketplace and Repaidians opportunities |
| Work summary | Status, title, schedule, progress, details | Bookings and contract cards |
| Form or message | Heading, short explanation, fields or next action | Quotes, empty states and feedback |

Use `Card` for new article, section or div cards. Existing domain card classes share
the same surface contract. Keep one primary action, group secondary actions, and
use a divider only when it separates information from actions. Images use a
consistent crop; informative profile pictures keep their existing identity crop.

## Typography and spacing

Poppins is self-hosted at weights 400, 500, 600 and 700. Body copy uses 400, controls
500, headings 600, and occasional emphasis 700. There are no remote font requests.
The files include Latin and Devanagari glyphs. The browser may use its script fallback
for characters Poppins does not contain. Logos and user-uploaded artwork are not
re-typeset. Font source hashes and the OFL licence are in `web/public/fonts/`.

Use 4, 8, 12, 16, 24 and 32px spacing. Cards use 16px padding on phones and 20px
on larger screens, with a 16px radius. Form controls keep 16px text; primary
interactive targets are at least 44px high. Layouts must remain usable at 320px
and with 200% text. Do not truncate essential prices, status or error messages.

Supporting labels in worker and business suites use at least 0.75rem; operating
instructions use 0.875rem. Use relative font sizes so reading preferences enlarge
the text. Calendar labels may wrap instead of clipping; text markers identify each day’s state without relying on colour. Fixed navigation measures
its actual height and reserves that space below the final record and action.

## Colour and accessibility

| Role | Light theme | Dark theme |
| --- | --- | --- |
| Main text | `#0b132b` | `#f5f7ff` |
| Secondary text | `#3e4c63` | `#d1dbea` |
| Card | `#ffffff` | `#182337` |
| Page | `#f4f6fa` | `#101827` |
| Link | `#003bb5` | `#bfd2ff` |
| Primary action | White on `#17285c` | White on `#17285c` |

Text pairs target WCAG AAA: 7:1 for normal text and 4.5:1 for large text.
Controls and focus indicators need the applicable non-text contrast, not 7:1.
States always include words or icons, never colour alone. Place banner text on a
solid surface so changing imagery cannot reduce contrast. Respect reduced motion.
Automated contrast checks support review; they are not full WCAG certification.

## Wording and async actions

Say what happened and what the customer can do next. Prefer “Changes saved”,
“Uploading…” or “Choose a date” over explanations of internal processes. Keep
payment, privacy, eligibility and agreement terms where they affect a decision.

A selected file is not yet uploaded; an uploaded file is not a saved form; a saved
draft is not published; a payment check is not payment confirmation. Show progress
until the server confirms the result. Retain drafts after failures and keep
completion feedback visible when a dialog closes. After an uncertain timeout,
ask the customer to check saved records before retrying.

API calls combine caller cancellation with a deadline: ordinary requests get
20 seconds (community requests 30); uploads get 120 seconds. Both cancellation
and rejection clear the loading state. Never automatically retry a write that
might already have succeeded.

## Verification

- `npm --prefix web test` includes deadline, cancellation and feedback regressions.
- `brand-system.browser.mjs` checks actual card/account components in both themes,
  at 320/465/1280px and enlarged text, with AAA contrast enabled.
- `brand-screens.browser.mjs` checks customer navigation and marketplace sections
  against a disposable local SQLite API, in both themes, at mobile/desktop widths
  and 200% text. It checks Poppins, AAA contrast and all five guest Bookings panels.
- `business-suites.browser.mjs` checks cab, driver, scrap and agent panels, fixed
  navigation, collection and journey actions, uploads, role permissions and idle
  states. `company-admin.browser.mjs` checks the compact mobile menu, content in
  both themes, independent loading, recovery and account changes.
- Existing market, wholesale, hiring, action-feedback and custom-contract browser suites
  exercise submission errors, recovery and confirmed outcomes with isolated data.

The Android customer app renders the same web interface. Native Poppins family
resources and their licence also live in the customer and agent Android apps; those require an APK
build to update the native launch screen.

Guest Bookings uses one sign-in card per panel. A normal sign-in requirement is
not an error or a failed connection and must not start a retry loop. Market empty
states offer Clear filters only when a filter is active; the page does not add a
second viewport of blank space inside the app shell. Carousel page controls use
a 44px target around a small visual dot, rather than displaying oversized dots.

The company/shop workspace uses a sidebar on desktop and an explicit workspace
menu on phones. Selecting a destination closes the phone menu, updates the
breadcrumb and focuses the new heading. All destinations remain available; API
errors do not change the selected workspace or erase already loaded records.

Customer contract details use the same spacing and status hierarchy as booking
cards: a breadcrumb, a summary card, a four-stage trail and named management
panels. Proposals open first; matching explanations and post settings start
closed. One panel opens at a time, and a closed panel keeps any draft already
started. Customer reaction totals are read-only facts, not disabled buttons.

An open contract shares one authenticated update watcher across its panels. It
checks a small server revision every 2.5 seconds and reloads saved data only when
that revision changes. Hidden tabs pause; returning or reconnecting checks
immediately. Interrupted connections show a retry status, and revoked access
clears private content. Exact sites, other contractors' bids and private messages
stay behind the existing server permissions. Agents who have recorded eligible
availability can react and comment, but cannot submit contractor proposals.

Run `web/tests/custom-contract-live.browser.mjs` against local Vite to test
simultaneous customer, contractor and agent sessions with disposable SQLite data,
reconnection, privacy, panel defaults, AAA contrast and 200% text layouts.
